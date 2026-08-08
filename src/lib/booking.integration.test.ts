import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema as s } from "@/db";
import { createBooking, createHold, getAvailability, listHolds } from "@/lib/booking";
import { redis } from "@/lib/redis";
import { atLocal, futureDateISO, resetAll, seedBusiness, type Fixture } from "@/test/fixtures";

let f: Fixture;
const date = futureDateISO();

beforeEach(async () => {
  await resetAll();
  f = await seedBusiness();
});

afterAll(async () => {
  await redis().quit();
});

const availability = () =>
  getAvailability({
    businessId: f.business.id,
    timeZone: f.business.timezone,
    staffId: f.master.id,
    serviceId: f.service.id,
    dateISO: date,
  });

/** Full happy path: hold a slot, then turn the hold into a booking. */
async function book(startMs: number, endMs: number, phone = "+77010000001") {
  const token = await createHold(f.master.id, { startMs, endMs }, 300);
  if (!token) return { ok: false as const, error: "slot_taken" as const };
  return createBooking({
    businessId: f.business.id,
    staffId: f.master.id,
    serviceId: f.service.id,
    slot: { startMs, endMs },
    holdToken: token,
    client: { name: "Client", phone },
  });
}

describe("availability", () => {
  it("offers the full working day when nothing is booked", async () => {
    const slots = await availability();
    expect(slots[0].startMs).toBe(atLocal(date, "10:00", f.business.timezone));
    // 10:00-20:00, 60-minute service, 15-minute grid -> last start is 19:00
    expect(slots.at(-1)!.startMs).toBe(atLocal(date, "19:00", f.business.timezone));
  });

  it("drops slots that overlap a confirmed booking", async () => {
    const start = atLocal(date, "12:00", f.business.timezone);
    await book(start, start + 3600_000);

    const starts = (await availability()).map((sl) => sl.startMs);
    expect(starts).not.toContain(start);
    expect(starts).not.toContain(start - 15 * 60_000); // 11:45 would run into 12:00
    expect(starts).toContain(start + 3600_000); // 13:00 starts exactly at the end
  });

  it("respects a per-master schedule override", async () => {
    await db.insert(s.staffHours).values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        staffId: f.master.id,
        weekday,
        startTime: "12:00",
        endTime: "15:00",
      })),
    );
    const starts = (await availability()).map((sl) => sl.startMs);
    expect(starts[0]).toBe(atLocal(date, "12:00", f.business.timezone));
    expect(starts.at(-1)).toBe(atLocal(date, "14:00", f.business.timezone));
  });
});

describe("slot holds", () => {
  it("hides a held slot from availability until the hold expires", async () => {
    const start = atLocal(date, "14:00", f.business.timezone);
    const token = await createHold(f.master.id, { startMs: start, endMs: start + 3600_000 }, 300);
    expect(token).toBeTruthy();

    expect((await availability()).map((sl) => sl.startMs)).not.toContain(start);
    expect(await listHolds(f.master.id, start - 3600_000, start + 7200_000)).toHaveLength(1);
  });

  it("refuses a second hold on the same slot", async () => {
    const start = atLocal(date, "14:00", f.business.timezone);
    const slot = { startMs: start, endMs: start + 3600_000 };
    expect(await createHold(f.master.id, slot, 300)).toBeTruthy();
    expect(await createHold(f.master.id, slot, 300)).toBeNull();
  });

  it("frees the slot once the hold TTL lapses", async () => {
    const start = atLocal(date, "14:00", f.business.timezone);
    await createHold(f.master.id, { startMs: start, endMs: start + 3600_000 }, 1);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await availability()).map((sl) => sl.startMs)).toContain(start);
  });
});

describe("createBooking", () => {
  it("rejects a booking whose hold token does not match", async () => {
    const start = atLocal(date, "16:00", f.business.timezone);
    const slot = { startMs: start, endMs: start + 3600_000 };
    await createHold(f.master.id, slot, 300);

    const result = await createBooking({
      businessId: f.business.id,
      staffId: f.master.id,
      serviceId: f.service.id,
      slot,
      holdToken: "not-the-real-token",
      client: { name: "Impostor", phone: "+77010000002" },
    });
    expect(result).toEqual({ ok: false, error: "hold_expired" });
  });

  it("consumes the hold so the same token cannot book twice", async () => {
    const start = atLocal(date, "16:00", f.business.timezone);
    const slot = { startMs: start, endMs: start + 3600_000 };
    const token = (await createHold(f.master.id, slot, 300))!;
    const args = {
      businessId: f.business.id,
      staffId: f.master.id,
      serviceId: f.service.id,
      slot,
      holdToken: token,
      client: { name: "Client", phone: "+77010000003" },
    };
    expect((await createBooking(args)).ok).toBe(true);
    expect(await createBooking(args)).toEqual({ ok: false, error: "hold_expired" });
  });

  it("reuses the client record for a repeat phone number", async () => {
    const a = atLocal(date, "11:00", f.business.timezone);
    const b = atLocal(date, "15:00", f.business.timezone);
    await book(a, a + 3600_000, "+77019999999");
    await book(b, b + 3600_000, "+77019999999");

    const clients = await db
      .select()
      .from(s.clients)
      .where(eq(s.clients.businessId, f.business.id));
    expect(clients).toHaveLength(1);
  });

  it("snapshots the price so later price changes do not rewrite history", async () => {
    const start = atLocal(date, "11:00", f.business.timezone);
    await book(start, start + 3600_000);
    await db.update(s.services).set({ priceKzt: 99000 }).where(eq(s.services.id, f.service.id));

    const [booking] = await db.select().from(s.bookings);
    expect(booking.priceKzt).toBe(8000);
  });

  it("writes an audit entry for every booking", async () => {
    const start = atLocal(date, "11:00", f.business.timezone);
    await book(start, start + 3600_000);
    const log = await db.select().from(s.auditLog);
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("booking.create");
  });
});

describe("concurrency", () => {
  // The whole double-booking claim rests on this: Redis holds are the first
  // line, the Postgres exclusion constraint is the last. Fire a crowd at one
  // slot and exactly one of them may end up with a booking.
  it("lets exactly one of 100 racing clients take a slot", async () => {
    const start = atLocal(date, "13:00", f.business.timezone);
    const slot = { startMs: start, endMs: start + 3600_000 };

    const attempts = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        book(slot.startMs, slot.endMs, `+7701000${String(i).padStart(4, "0")}`),
      ),
    );

    expect(attempts.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(s.bookings)).toHaveLength(1);
  });

  it("still holds the line when the Redis hold is bypassed entirely", async () => {
    // Simulates the nightmare case: two app servers both convinced the slot is
    // free (expired hold, flushed cache, a bug). The database must not budge.
    const start = atLocal(date, "13:00", f.business.timezone);
    const slot = { startMs: start, endMs: start + 3600_000 };

    const [client] = await db
      .insert(s.clients)
      .values({ businessId: f.business.id, name: "Racer", phone: "+77015550000" })
      .returning();

    const row = {
      businessId: f.business.id,
      staffId: f.master.id,
      serviceId: f.service.id,
      clientId: client.id,
      startAt: new Date(slot.startMs),
      endAt: new Date(slot.endMs),
      status: "confirmed" as const,
      priceKzt: 8000,
    };

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => db.insert(s.bookings).values(row)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(s.bookings)).toHaveLength(1);
  });

  it("allows overlapping bookings for different masters", async () => {
    const [second] = await db
      .insert(s.staff)
      .values({ businessId: f.business.id, name: "Second" })
      .returning();
    await db.insert(s.staffServices).values({ staffId: second.id, serviceId: f.service.id });

    const start = atLocal(date, "13:00", f.business.timezone);
    const slot = { startMs: start, endMs: start + 3600_000 };

    const first = await book(slot.startMs, slot.endMs, "+77010000010");
    const token = (await createHold(second.id, slot, 300))!;
    const other = await createBooking({
      businessId: f.business.id,
      staffId: second.id,
      serviceId: f.service.id,
      slot,
      holdToken: token,
      client: { name: "Other", phone: "+77010000011" },
    });

    expect(first.ok).toBe(true);
    expect(other.ok).toBe(true);
  });

  it("frees the slot again after the booking is cancelled", async () => {
    const start = atLocal(date, "13:00", f.business.timezone);
    const slot = { startMs: start, endMs: start + 3600_000 };
    const first = await book(slot.startMs, slot.endMs);
    expect(first.ok).toBe(true);

    // The exclusion constraint only covers confirmed rows, so a cancelled
    // booking must not keep blocking the time.
    await db.update(s.bookings).set({ status: "cancelled" });
    expect((await availability()).map((sl) => sl.startMs)).toContain(start);

    const again = await book(slot.startMs, slot.endMs, "+77010000012");
    expect(again.ok).toBe(true);
  });
});
