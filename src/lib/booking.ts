import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { cancelByDedupeKey, enqueue } from "./outbox";
import { redis } from "./redis";
import { localTimeToUtc, isoWeekday, slotsForDay, type Range } from "./slots";

// ---------- Redis slot holds (first line of defense against double-booking) ----------

const holdKey = (staffId: string, startMs: number) => `hold:${staffId}:${startMs}`;

export type Hold = { token: string; endMs: number };

/** Try to place a hold on a slot. Returns a token, or null if already held. */
export async function createHold(
  staffId: string,
  slot: Range,
  ttlSec: number,
): Promise<string | null> {
  const token = randomBytes(16).toString("hex");
  const ok = await redis().set(
    holdKey(staffId, slot.startMs),
    JSON.stringify({ token, endMs: slot.endMs } satisfies Hold),
    "EX",
    ttlSec,
    "NX",
  );
  return ok ? token : null;
}

/** Active holds for a master within [fromMs, toMs). */
// ponytail: KEYS-scan per request is O(active holds); holds expire in minutes,
// so the set stays tiny. Move to a per-staff zset if a business ever needs it.
export async function listHolds(staffId: string, fromMs: number, toMs: number): Promise<Range[]> {
  const keys = await redis().keys(`hold:${staffId}:*`);
  if (keys.length === 0) return [];
  const values = await redis().mget(keys);
  const out: Range[] = [];
  keys.forEach((k, i) => {
    const raw = values[i];
    if (!raw) return;
    const startMs = Number(k.split(":")[2]);
    const { endMs } = JSON.parse(raw) as Hold;
    if (startMs < toMs && endMs > fromMs) out.push({ startMs, endMs });
  });
  return out;
}

// ---------- Calendar events (Redis pub/sub → SSE) ----------

export const calendarChannel = (businessId: string) => `calendar:${businessId}`;

export async function publishCalendar(businessId: string, event: object): Promise<void> {
  await redis().publish(calendarChannel(businessId), JSON.stringify(event));
}

// ---------- Availability ----------

async function dayWindowFor(
  businessId: string,
  staffId: string,
  dateISO: string,
): Promise<{ open: string; close: string } | null> {
  const weekday = isoWeekday(dateISO);
  const [override] = await db
    .select()
    .from(s.staffHours)
    .where(and(eq(s.staffHours.staffId, staffId), eq(s.staffHours.weekday, weekday)));
  if (override) return { open: override.startTime, close: override.endTime };
  const [base] = await db
    .select()
    .from(s.businessHours)
    .where(and(eq(s.businessHours.businessId, businessId), eq(s.businessHours.weekday, weekday)));
  return base ? { open: base.openTime, close: base.closeTime } : null;
}

export async function getAvailability(opts: {
  businessId: string;
  timeZone: string;
  staffId: string;
  serviceId: string;
  dateISO: string;
}): Promise<Range[]> {
  const { businessId, timeZone, staffId, serviceId, dateISO } = opts;
  const [service] = await db
    .select()
    .from(s.services)
    .where(and(eq(s.services.id, serviceId), eq(s.services.businessId, businessId)));
  if (!service?.isActive) return [];

  const window = await dayWindowFor(businessId, staffId, dateISO);
  if (!window) return [];

  const dayStart = localTimeToUtc(dateISO, "00:00", timeZone);
  const dayEnd = dayStart + 36 * 3600_000; // generous bound; window trims precisely
  const busyRows = await db
    .select({ startAt: s.bookings.startAt, endAt: s.bookings.endAt })
    .from(s.bookings)
    .where(
      and(
        eq(s.bookings.staffId, staffId),
        eq(s.bookings.status, "confirmed"),
        gte(s.bookings.endAt, new Date(dayStart)),
        lt(s.bookings.startAt, new Date(dayEnd)),
      ),
    );
  const busy = busyRows.map((b) => ({ startMs: b.startAt.getTime(), endMs: b.endAt.getTime() }));
  const holds = await listHolds(staffId, dayStart, dayEnd);

  return slotsForDay({
    dateISO,
    timeZone,
    window,
    durationMin: service.durationMin,
    busy,
    holds,
    notBeforeMs: Date.now(),
  });
}

// ---------- Booking creation ----------

export type BookResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: "hold_expired" | "slot_taken" };

export async function createBooking(opts: {
  businessId: string;
  staffId: string;
  serviceId: string;
  slot: Range;
  holdToken: string;
  client: { name: string; phone: string };
}): Promise<BookResult> {
  const { businessId, staffId, serviceId, slot, holdToken, client } = opts;

  // The hold must still be alive and belong to this caller.
  const raw = await redis().get(holdKey(staffId, slot.startMs));
  if (!raw || (JSON.parse(raw) as Hold).token !== holdToken) {
    return { ok: false, error: "hold_expired" };
  }

  const [service] = await db
    .select()
    .from(s.services)
    .where(and(eq(s.services.id, serviceId), eq(s.services.businessId, businessId)));
  if (!service) return { ok: false, error: "slot_taken" };

  // Upsert client by (business, phone)
  const [existing] = await db
    .select()
    .from(s.clients)
    .where(and(eq(s.clients.businessId, businessId), eq(s.clients.phone, client.phone)));
  const clientRow =
    existing ??
    (await db
      .insert(s.clients)
      .values({ businessId, name: client.name, phone: client.phone })
      .returning())[0];

  try {
    // Booking, audit trail and outbound messages commit together: a client can
    // never end up with a confirmation for a booking that was rolled back.
    const bookingId = await db.transaction(async (tx) => {
      const [booking] = await tx
        .insert(s.bookings)
        .values({
          businessId,
          staffId,
          serviceId,
          clientId: clientRow.id,
          startAt: new Date(slot.startMs),
          endAt: new Date(slot.endMs),
          status: "confirmed",
          priceKzt: service.priceKzt,
        })
        .returning();

      await tx.insert(s.auditLog).values({
        businessId,
        action: "booking.create",
        entity: "booking",
        entityId: booking.id,
        meta: { staffId, serviceId, startAt: new Date(slot.startMs).toISOString() },
      });

      await enqueue(tx, {
        businessId,
        topic: "booking.confirmed",
        payload: { bookingId: booking.id },
        dedupeKey: `booking.confirmed:${booking.id}`,
      });

      // Reminder the day before; retired automatically if the booking is
      // cancelled before the worker gets to it.
      const remindAt = new Date(slot.startMs - 24 * 3600_000);
      if (remindAt.getTime() > Date.now()) {
        await enqueue(tx, {
          businessId,
          topic: "booking.reminder",
          payload: { bookingId: booking.id },
          dedupeKey: `booking.reminder:${booking.id}`,
          availableAt: remindAt,
        });
      }

      return booking.id;
    });

    await redis().del(holdKey(staffId, slot.startMs));
    await publishCalendar(businessId, { type: "booking.created", bookingId });
    return { ok: true, bookingId };
  } catch (e) {
    // 23P01 = exclusion_violation: the DB constraint is the last line of defense.
    if (isPgError(e, "23P01")) return { ok: false, error: "slot_taken" };
    throw e;
  }
}

/** Drizzle wraps driver errors, so the pg code can sit a few `cause` links down. */
function isPgError(error: unknown, code: string): boolean {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === code) return true;
  }
  return false;
}

export async function setBookingStatus(opts: {
  businessId: string;
  bookingId: string;
  status: (typeof s.bookingStatuses)[number];
  actorUserId: string;
}): Promise<void> {
  const { businessId, bookingId, status, actorUserId } = opts;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(s.bookings)
      .set({ status })
      .where(and(eq(s.bookings.id, bookingId), eq(s.bookings.businessId, businessId)))
      .returning();
    if (!updated) return;
    await tx.insert(s.auditLog).values({
      businessId,
      actorUserId,
      action: `booking.${status}`,
      entity: "booking",
      entityId: bookingId,
    });

    if (status !== "confirmed") {
      // Nobody wants a reminder for an appointment that is no longer happening.
      await cancelByDedupeKey(tx, `booking.reminder:${bookingId}`);
    }
    if (status === "cancelled") {
      await enqueue(tx, {
        businessId,
        topic: "booking.cancelled",
        payload: { bookingId },
        dedupeKey: `booking.cancelled:${bookingId}`,
      });
      // The time is free again — offer it down the waitlist before it goes
      // back into public stock. Enqueued rather than called directly: keeps
      // this transaction pure SQL, and keeps booking.ts free of a dependency
      // on waitlist.ts (which already depends on this file).
      await enqueue(tx, {
        businessId,
        topic: "waitlist.slot_freed",
        payload: {
          staffId: updated.staffId,
          serviceId: updated.serviceId,
          startMs: updated.startAt.getTime(),
          endMs: updated.endAt.getTime(),
        },
        dedupeKey: `waitlist.freed:${bookingId}`,
      });
    }
  });
  await publishCalendar(businessId, { type: "booking.updated", bookingId });
}

export async function staffForService(businessId: string, serviceId: string) {
  const links = await db
    .select({ staffId: s.staffServices.staffId })
    .from(s.staffServices)
    .where(eq(s.staffServices.serviceId, serviceId));
  if (links.length === 0) return [];
  return db
    .select({ id: s.staff.id, name: s.staff.name })
    .from(s.staff)
    .where(
      and(
        eq(s.staff.businessId, businessId),
        eq(s.staff.isActive, true),
        inArray(s.staff.id, links.map((l) => l.staffId)),
      ),
    );
}
