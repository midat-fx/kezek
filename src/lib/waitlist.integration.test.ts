import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema as s } from "@/db";
import { createBooking, createHold, getAvailability, setBookingStatus } from "@/lib/booking";
import { drainOnce } from "@/lib/notify/worker";
import { redis } from "@/lib/redis";
import { atLocal, futureDateISO, resetAll, seedBusiness, type Fixture } from "@/test/fixtures";
import { acceptOffer, expireOffer, joinWaitlist } from "./waitlist";

let f: Fixture;
const date = futureDateISO();
const HH = "12:00";

beforeEach(async () => {
  await resetAll();
  f = await seedBusiness();
});

afterAll(async () => {
  await redis().quit();
});

function slotAt(hhmm = HH) {
  const start = atLocal(date, hhmm, f.business.timezone);
  return { startMs: start, endMs: start + 3600_000 };
}

async function book(phone = "+77010000001", hhmm = HH) {
  const slot = slotAt(hhmm);
  const token = (await createHold(f.master.id, slot, 300))!;
  return createBooking({
    businessId: f.business.id,
    staffId: f.master.id,
    serviceId: f.service.id,
    slot,
    holdToken: token,
    client: { name: "Booked", phone },
  });
}

const join = (phone: string, staffId?: string | null) =>
  joinWaitlist({
    businessId: f.business.id,
    serviceId: f.service.id,
    staffId,
    dateISO: date,
    client: { name: `W-${phone.slice(-4)}`, phone },
  });

async function cancel(bookingId: string) {
  await setBookingStatus({
    businessId: f.business.id,
    bookingId,
    status: "cancelled",
    actorUserId: f.owner.id,
  });
}

const entries = () => db.select().from(s.waitlistEntries);
const messages = () => db.select().from(s.messageLog);

describe("joining", () => {
  it("records the client and the requested day", async () => {
    await join("+77011111111");
    const [entry] = await entries();
    expect(entry.status).toBe("waiting");
    expect(entry.dateISO).toBe(date);

    const [client] = await db.select().from(s.clients);
    expect(client.phone).toBe("+77011111111");
  });

  it("reuses an existing client for the same phone", async () => {
    await join("+77011111111");
    await join("+77011111111");
    expect(await db.select().from(s.clients)).toHaveLength(1);
    expect(await entries()).toHaveLength(2);
  });
});

describe("offering a freed slot", () => {
  it("offers to the longest-waiting client and holds the slot for them", async () => {
    const booked = await book();
    await join("+77012222222"); // first in line
    await join("+77013333333");

    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce(); // slot_freed -> offer
    await drainOnce(); // deliver the offer SMS

    const rows = await entries();
    const offered = rows.filter((r) => r.status === "offered");
    expect(offered).toHaveLength(1);
    expect(offered[0].offerToken).toBeTruthy();

    const [client] = await db
      .select()
      .from(s.clients)
      .where(eq(s.clients.id, offered[0].clientId));
    expect(client.phone).toBe("+77012222222");

    // Held for them: the public availability no longer shows the slot.
    const free = await getAvailability({
      businessId: f.business.id,
      timeZone: f.business.timezone,
      staffId: f.master.id,
      serviceId: f.service.id,
      dateISO: date,
    });
    expect(free.map((sl) => sl.startMs)).not.toContain(slotAt().startMs);

    const sms = await messages();
    expect(sms.some((m) => m.recipient === "+77012222222" && m.subject.includes("освободилось")))
      .toBe(true);
  });

  it("skips clients who wanted a different master", async () => {
    const [other] = await db
      .insert(s.staff)
      .values({ businessId: f.business.id, name: "Other" })
      .returning();

    const booked = await book();
    await join("+77014444444", other.id); // wants someone else
    await join("+77015555555", null); // any master

    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce();

    const offered = (await entries()).find((r) => r.status === "offered")!;
    const [client] = await db
      .select()
      .from(s.clients)
      .where(eq(s.clients.id, offered.clientId));
    expect(client.phone).toBe("+77015555555");
  });

  it("does nothing when nobody is waiting", async () => {
    const booked = await book();
    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce();
    expect(await entries()).toHaveLength(0);

    // Slot returns to public stock.
    const free = await getAvailability({
      businessId: f.business.id,
      timeZone: f.business.timezone,
      staffId: f.master.id,
      serviceId: f.service.id,
      dateISO: date,
    });
    expect(free.map((sl) => sl.startMs)).toContain(slotAt().startMs);
  });
});

describe("accepting an offer", () => {
  it("turns the offer into a booking", async () => {
    const booked = await book();
    await join("+77012222222");
    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce();

    const offered = (await entries()).find((r) => r.status === "offered")!;
    const result = await acceptOffer(offered.offerToken!);
    expect(result.ok).toBe(true);

    const confirmed = await db
      .select()
      .from(s.bookings)
      .where(eq(s.bookings.status, "confirmed"));
    expect(confirmed).toHaveLength(1);
    expect((await entries())[0].status).toBe("booked");
  });

  it("refuses an unknown or already-used token", async () => {
    expect(await acceptOffer("nope")).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses once the deadline has passed", async () => {
    const booked = await book();
    await join("+77012222222");
    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce();

    const offered = (await entries()).find((r) => r.status === "offered")!;
    await db
      .update(s.waitlistEntries)
      .set({ offerExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.waitlistEntries.id, offered.id));

    expect(await acceptOffer(offered.offerToken!)).toEqual({ ok: false, error: "expired" });
  });
});

describe("offer expiry moves down the queue", () => {
  it("passes the slot to the next person when the first does not answer", async () => {
    const booked = await book();
    await join("+77012222222"); // first
    await join("+77013333333"); // second

    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce();

    const first = (await entries()).find((r) => r.status === "offered")!;
    await expireOffer(first.id);
    await drainOnce(); // the re-announced slot_freed
    await drainOnce(); // deliver the second offer

    const rows = await entries();
    expect(rows.find((r) => r.id === first.id)!.status).toBe("expired");

    const second = rows.find((r) => r.status === "offered")!;
    const [client] = await db
      .select()
      .from(s.clients)
      .where(eq(s.clients.id, second.clientId));
    expect(client.phone).toBe("+77013333333");
  });

  it("returns the slot to public stock once the queue is exhausted", async () => {
    const booked = await book();
    await join("+77012222222");
    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce();

    const only = (await entries()).find((r) => r.status === "offered")!;
    await expireOffer(only.id);
    await drainOnce();

    const free = await getAvailability({
      businessId: f.business.id,
      timeZone: f.business.timezone,
      staffId: f.master.id,
      serviceId: f.service.id,
      dateISO: date,
    });
    expect(free.map((sl) => sl.startMs)).toContain(slotAt().startMs);
  });

  it("leaves an already-accepted offer alone", async () => {
    const booked = await book();
    await join("+77012222222");
    await cancel((booked as { bookingId: string }).bookingId);
    await drainOnce();

    const offered = (await entries()).find((r) => r.status === "offered")!;
    await acceptOffer(offered.offerToken!);
    await expireOffer(offered.id); // deadline fires after acceptance

    expect((await entries())[0].status).toBe("booked");
    expect(await db.select().from(s.bookings).where(eq(s.bookings.status, "confirmed")))
      .toHaveLength(1);
  });
});
