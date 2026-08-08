import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { createBooking, createHold, publishCalendar } from "./booking";
import { enqueue } from "./outbox";
import { redis } from "./redis";

/** How long a client has to accept a freed slot before it moves down the queue. */
export const OFFER_TTL_SEC = 15 * 60;

export type JoinResult = { entryId: string };

export async function joinWaitlist(opts: {
  businessId: string;
  serviceId: string;
  staffId?: string | null;
  dateISO: string;
  client: { name: string; phone: string };
}): Promise<JoinResult> {
  const { businessId, serviceId, staffId, dateISO, client } = opts;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(s.clients)
      .where(and(eq(s.clients.businessId, businessId), eq(s.clients.phone, client.phone)));
    const clientRow =
      existing ??
      (
        await tx
          .insert(s.clients)
          .values({ businessId, name: client.name, phone: client.phone })
          .returning()
      )[0];

    const [entry] = await tx
      .insert(s.waitlistEntries)
      .values({
        businessId,
        serviceId,
        staffId: staffId ?? null,
        clientId: clientRow.id,
        dateISO,
      })
      .returning();

    return { entryId: entry.id };
  });
}

type FreedSlot = { staffId: string; serviceId: string; startMs: number; endMs: number };

/**
 * Offers a freed slot to the longest-waiting eligible client.
 *
 * Eligibility: same service, same local day, and either no master preference
 * or a preference for the one who freed up. Returns the entry that was offered,
 * or null when nobody is waiting (the slot simply returns to public stock).
 */
export async function offerFreedSlot(businessId: string, slot: FreedSlot): Promise<string | null> {
  const [business] = await db.select().from(s.businesses).where(eq(s.businesses.id, businessId));
  if (!business) return null;

  const dateISO = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(
    slot.startMs,
  );

  const [entry] = await db
    .select()
    .from(s.waitlistEntries)
    .where(
      and(
        eq(s.waitlistEntries.businessId, businessId),
        eq(s.waitlistEntries.serviceId, slot.serviceId),
        eq(s.waitlistEntries.dateISO, dateISO),
        eq(s.waitlistEntries.status, "waiting"),
        or(isNull(s.waitlistEntries.staffId), eq(s.waitlistEntries.staffId, slot.staffId)),
      ),
    )
    .orderBy(asc(s.waitlistEntries.createdAt))
    .limit(1);

  if (!entry) return null;

  // Reserve the slot for them specifically, so a walk-in cannot take it out
  // from under an outstanding offer.
  const token = randomBytes(16).toString("hex");
  const held = await createHold(
    slot.staffId,
    { startMs: slot.startMs, endMs: slot.endMs },
    OFFER_TTL_SEC,
  );
  if (!held) return null; // someone booked it first; nothing to offer

  const expiresAt = new Date(Date.now() + OFFER_TTL_SEC * 1000);

  await db.transaction(async (tx) => {
    await tx
      .update(s.waitlistEntries)
      .set({
        status: "offered",
        offerToken: token,
        offerHoldToken: held,
        offerSlotStartAt: new Date(slot.startMs),
        offerSlotEndAt: new Date(slot.endMs),
        offerExpiresAt: expiresAt,
        offerStaffId: slot.staffId,
      })
      .where(eq(s.waitlistEntries.id, entry.id));

    await tx.insert(s.auditLog).values({
      businessId,
      action: "waitlist.offered",
      entity: "waitlist_entry",
      entityId: entry.id,
      meta: { staffId: slot.staffId, startMs: slot.startMs },
    });

    await enqueue(tx, {
      businessId,
      topic: "waitlist.offer",
      payload: { entryId: entry.id },
      dedupeKey: `waitlist.offer:${entry.id}:${slot.startMs}`,
    });

    // Self-scheduled deadline: if they have not accepted by then, the offer
    // lapses and the slot is announced again for the next person in line.
    await enqueue(tx, {
      businessId,
      topic: "waitlist.offer_expired",
      payload: { entryId: entry.id },
      dedupeKey: `waitlist.expire:${entry.id}:${slot.startMs}`,
      availableAt: expiresAt,
    });
  });

  return entry.id;
}

/** Called by the worker when an offer's deadline passes. */
export async function expireOffer(entryId: string): Promise<void> {
  const [entry] = await db
    .select()
    .from(s.waitlistEntries)
    .where(eq(s.waitlistEntries.id, entryId));
  if (!entry || entry.status !== "offered") return; // accepted or cancelled already

  const slot = {
    staffId: entry.offerStaffId!,
    serviceId: entry.serviceId,
    startMs: entry.offerSlotStartAt!.getTime(),
    endMs: entry.offerSlotEndAt!.getTime(),
  };

  await db.transaction(async (tx) => {
    await tx
      .update(s.waitlistEntries)
      .set({
        status: "expired",
        offerToken: null,
        offerExpiresAt: null,
      })
      .where(eq(s.waitlistEntries.id, entryId));

    // Hand the slot to whoever is next.
    await enqueue(tx, {
      businessId: entry.businessId,
      topic: "waitlist.slot_freed",
      payload: slot,
      dedupeKey: `waitlist.refree:${entryId}:${slot.startMs}`,
    });
  });

  await releaseHold(slot.staffId, slot.startMs);
}

async function releaseHold(staffId: string, startMs: number): Promise<void> {
  await redis().del(`hold:${staffId}:${startMs}`);
}

export type AcceptResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: "not_found" | "expired" | "slot_taken" };

/** Turns an outstanding offer into a real booking. */
export async function acceptOffer(token: string): Promise<AcceptResult> {
  const [entry] = await db
    .select()
    .from(s.waitlistEntries)
    .where(eq(s.waitlistEntries.offerToken, token));
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.status !== "offered") return { ok: false, error: "expired" };
  if (!entry.offerExpiresAt || entry.offerExpiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired" };
  }

  const [client] = await db.select().from(s.clients).where(eq(s.clients.id, entry.clientId));
  const holdToken = entry.offerHoldToken;
  if (!holdToken) return { ok: false, error: "expired" };

  const result = await createBooking({
    businessId: entry.businessId,
    staffId: entry.offerStaffId!,
    serviceId: entry.serviceId,
    slot: {
      startMs: entry.offerSlotStartAt!.getTime(),
      endMs: entry.offerSlotEndAt!.getTime(),
    },
    holdToken,
    client: { name: client.name, phone: client.phone },
  });

  if (!result.ok) return { ok: false, error: "slot_taken" };

  await db
    .update(s.waitlistEntries)
    .set({ status: "booked", offerToken: null, offerHoldToken: null })
    .where(eq(s.waitlistEntries.id, entry.id));
  await publishCalendar(entry.businessId, { type: "booking.created", bookingId: result.bookingId });

  return { ok: true, bookingId: result.bookingId };
}
