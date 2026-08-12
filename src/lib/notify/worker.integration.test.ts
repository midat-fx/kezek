import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema as s } from "@/db";
import { createBooking, createHold, setBookingStatus } from "@/lib/booking";
import { claim, enqueue } from "@/lib/outbox";
import { redis } from "@/lib/redis";
import { atLocal, futureDateISO, resetAll, seedBusiness, type Fixture } from "@/test/fixtures";
import { __setChannel, type Channel } from "./channels";
import { drainOnce } from "./worker";

let f: Fixture;
const date = futureDateISO();

beforeEach(async () => {
  await resetAll();
  f = await seedBusiness();
});

afterAll(async () => {
  await redis().quit();
});

async function book(hhmm: string, phone = "+77010000001") {
  const start = atLocal(date, hhmm, f.business.timezone);
  const slot = { startMs: start, endMs: start + 3600_000 };
  const token = (await createHold(f.master.id, slot, 300))!;
  return createBooking({
    businessId: f.business.id,
    staffId: f.master.id,
    serviceId: f.service.id,
    slot,
    holdToken: token,
    client: { name: "Client", phone },
  });
}

const outboxRows = () => db.select().from(s.outbox);
const messages = () => db.select().from(s.messageLog);

describe("enqueue on booking", () => {
  it("writes a confirmation and a reminder in the booking transaction", async () => {
    const result = await book("12:00");
    expect(result.ok).toBe(true);

    const rows = await outboxRows();
    expect(rows.map((r) => r.topic).sort()).toEqual(["booking.confirmed", "booking.reminder"]);

    const reminder = rows.find((r) => r.topic === "booking.reminder")!;
    const start = atLocal(date, "12:00", f.business.timezone);
    expect(reminder.availableAt.getTime()).toBe(start - 24 * 3600_000);
  });

  it("leaves nothing behind when the booking is rejected", async () => {
    await book("12:00");
    // Same slot, fresh hold is impossible — force the exclusion violation path
    // by clearing Redis so the DB constraint is what rejects it.
    await redis().flushdb();
    const second = await book("12:00", "+77010000002");

    expect(second.ok).toBe(false);
    expect(await outboxRows()).toHaveLength(2); // still only the first booking's
  });
});

describe("drainOnce", () => {
  it("delivers a due message and marks it sent", async () => {
    await book("12:00");
    const result = await drainOnce();

    expect(result.sent).toBe(1); // reminder is not due yet
    const sent = await messages();
    expect(sent).toHaveLength(1);
    expect(sent[0].recipient).toBe("+77010000001");
    expect(sent[0].body).toContain("Haircut");

    const rows = await outboxRows();
    expect(rows.find((r) => r.topic === "booking.confirmed")!.status).toBe("sent");
    expect(rows.find((r) => r.topic === "booking.reminder")!.status).toBe("pending");
  });

  it("ignores messages that are not due yet", async () => {
    await enqueue(db, {
      businessId: f.business.id,
      topic: "booking.confirmed",
      payload: { bookingId: "00000000-0000-0000-0000-000000000000" },
      availableAt: new Date(Date.now() + 60_000),
    });
    expect((await drainOnce()).claimed).toBe(0);
  });

  it("retires a reminder whose booking was cancelled, without sending", async () => {
    const result = await book("12:00");
    await drainOnce(); // clear the confirmation

    await setBookingStatus({
      businessId: f.business.id,
      bookingId: (result as { bookingId: string }).bookingId,
      status: "cancelled",
      actorUserId: f.owner.id,
    });

    const rows = await outboxRows();
    expect(rows.find((r) => r.topic === "booking.reminder")!.status).toBe("cancelled");

    // The cancellation notice is due immediately; the reminder never fires.
    const drained = await drainOnce();
    expect(drained.sent).toBe(1);
    const bodies = (await messages()).map((m) => m.subject);
    expect(bodies.some((b) => b.includes("cancelled"))).toBe(true);
    expect(bodies.some((b) => b.includes("reminder"))).toBe(false);
  });

  it("retries with backoff when a channel fails, then gives up", async () => {
    const failing: Channel = {
      name: "sms",
      async send() {
        throw new Error("gateway down");
      },
    };
    const restore = __setChannel("sms", failing);
    try {
      await book("12:00");
      const [confirmed] = await db
        .select()
        .from(s.outbox)
        .where(eq(s.outbox.topic, "booking.confirmed"));
      await db.update(s.outbox).set({ maxAttempts: 2 }).where(eq(s.outbox.id, confirmed.id));

      expect((await drainOnce()).failed).toBe(1);
      let row = (await outboxRows()).find((r) => r.id === confirmed.id)!;
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
      expect(row.lastError).toContain("gateway down");
      expect(row.availableAt.getTime()).toBeGreaterThan(Date.now()); // backed off

      // Second and final attempt.
      await db.update(s.outbox).set({ availableAt: new Date() }).where(eq(s.outbox.id, confirmed.id));
      expect((await drainOnce()).failed).toBe(1);
      row = (await outboxRows()).find((r) => r.id === confirmed.id)!;
      expect(row.status).toBe("dead");
      expect(await messages()).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("is idempotent per dedupe key", async () => {
    const msg = {
      businessId: f.business.id,
      topic: "booking.confirmed",
      payload: { bookingId: "x" },
      dedupeKey: "same-key",
    };
    await enqueue(db, msg);
    await enqueue(db, msg);
    expect(await outboxRows()).toHaveLength(1);
  });
});

describe("concurrent workers", () => {
  // FOR UPDATE SKIP LOCKED is the reason this app can run on more than one
  // instance without customers getting the same SMS twice.
  it("hands each message to exactly one of many racing claimers", async () => {
    const bookings = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];
    for (const [i, hhmm] of bookings.entries()) {
      await book(hhmm, `+7701000${String(i).padStart(4, "0")}`);
    }
    const due = (await outboxRows()).filter((r) => r.availableAt.getTime() <= Date.now());
    expect(due).toHaveLength(bookings.length);

    // Ten workers grab at once; every row must be claimed exactly once.
    const claimed = await Promise.all(Array.from({ length: 10 }, () => claim(5)));
    const ids = claimed.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(due.length);
  });

  it("does not double-send when two drains overlap", async () => {
    for (const [i, hhmm] of ["10:00", "11:00", "12:00"].entries()) {
      await book(hhmm, `+7701111${String(i).padStart(4, "0")}`);
    }
    const [a, b] = await Promise.all([drainOnce(), drainOnce()]);
    expect(a.sent + b.sent).toBe(3);
    expect(await messages()).toHaveLength(3);
  });
});
