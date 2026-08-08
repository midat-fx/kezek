import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema as s } from "@/db";
import { cohorts, revenueTrend, topClients, utilization } from "./analytics";
import { redis } from "@/lib/redis";
import { resetAll, seedBusiness, type Fixture } from "@/test/fixtures";

let f: Fixture;

beforeEach(async () => {
  await resetAll();
  f = await seedBusiness();
});

afterAll(async () => {
  await redis().quit();
});

/** Inserts a completed booking `daysAgo` days back at 12:00 UTC. */
async function completed(opts: {
  daysAgo: number;
  priceKzt: number;
  clientId: string;
  staffId?: string;
  durationMin?: number;
}) {
  const day = new Date(Date.now() - opts.daysAgo * 24 * 3600_000);
  day.setUTCHours(6, 0, 0, 0); // 11:00 Almaty — inside opening hours
  const end = new Date(day.getTime() + (opts.durationMin ?? 60) * 60_000);
  await db.insert(s.bookings).values({
    businessId: f.business.id,
    staffId: opts.staffId ?? f.master.id,
    serviceId: f.service.id,
    clientId: opts.clientId,
    startAt: day,
    endAt: end,
    status: "completed",
    priceKzt: opts.priceKzt,
  });
}

async function client(name: string, phone: string) {
  const [c] = await db
    .insert(s.clients)
    .values({ businessId: f.business.id, name, phone })
    .returning();
  return c;
}

describe("revenueTrend", () => {
  it("returns a dense series with zeros on quiet days", async () => {
    const c = await client("A", "+77010000001");
    await completed({ daysAgo: 1, priceKzt: 10000, clientId: c.id });

    const series = await revenueTrend(f.business.id, 10);
    expect(series).toHaveLength(10);
    expect(series.filter((p) => p.revenue === 0).length).toBe(9);
  });

  it("computes a 7-day trailing mean and a running total", async () => {
    const c = await client("A", "+77010000001");
    // 7000 on each of three consecutive days
    for (const daysAgo of [3, 2, 1]) {
      await completed({ daysAgo, priceKzt: 7000, clientId: c.id });
    }

    const series = await revenueTrend(f.business.id, 10);
    const last = series.at(-2)!; // yesterday; today has nothing
    expect(last.revenue).toBe(7000);
    expect(last.cumulative).toBe(21000);
    // Window covers 7 days: three at 7000, four at 0 -> 3000
    expect(last.movingAvg).toBe(3000);
  });
});

describe("utilization", () => {
  it("divides booked minutes by the hours actually on offer", async () => {
    const c = await client("A", "+77010000001");
    // Business is open 10:00-20:00 = 600 min/day; 30-day window.
    await completed({ daysAgo: 1, priceKzt: 8000, clientId: c.id, durationMin: 60 });
    await completed({ daysAgo: 2, priceKzt: 8000, clientId: c.id, durationMin: 120 });

    const [row] = await utilization(f.business.id, 30);
    expect(row.staffName).toBe("Master");
    expect(row.availableMinutes).toBe(30 * 600);
    expect(row.bookedMinutes).toBe(180);
    expect(row.utilization).toBeCloseTo(180 / (30 * 600), 6);
    expect(row.revenue).toBe(16000);
  });

  it("uses a master's own hours when they have them", async () => {
    await db.insert(s.staffHours).values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        staffId: f.master.id,
        weekday,
        startTime: "12:00",
        endTime: "15:00", // 180 min/day instead of 600
      })),
    );
    const [row] = await utilization(f.business.id, 10);
    expect(row.availableMinutes).toBe(10 * 180);
  });

  it("reports zero utilization for a master with no bookings", async () => {
    const [row] = await utilization(f.business.id, 7);
    expect(row.bookedMinutes).toBe(0);
    expect(row.utilization).toBe(0);
  });
});

describe("cohorts", () => {
  it("groups clients by first visit and counts their return months", async () => {
    const a = await client("A", "+77010000001");
    const b = await client("B", "+77010000002");

    // Both first seen ~2 months ago; only A comes back this month.
    await completed({ daysAgo: 62, priceKzt: 5000, clientId: a.id });
    await completed({ daysAgo: 61, priceKzt: 5000, clientId: b.id });
    await completed({ daysAgo: 1, priceKzt: 5000, clientId: a.id });

    const rows = await cohorts(f.business.id, 6);
    const cohort = rows.find((r) => r.size === 2);
    expect(cohort).toBeDefined();
    expect(cohort!.retained[0]).toBe(2); // both in month 0
    expect(cohort!.retained.at(-1)).toBe(1); // only A returned later
  });
});

describe("topClients", () => {
  it("ranks by revenue with a cumulative Pareto share", async () => {
    const big = await client("Big", "+77010000001");
    const small = await client("Small", "+77010000002");
    await completed({ daysAgo: 1, priceKzt: 75000, clientId: big.id });
    await completed({ daysAgo: 2, priceKzt: 25000, clientId: small.id });

    const rows = await topClients(f.business.id, 10);
    expect(rows.map((r) => r.name)).toEqual(["Big", "Small"]);
    expect(rows[0].cumulativeShare).toBeCloseTo(0.75, 4);
    expect(rows[1].cumulativeShare).toBeCloseTo(1, 4);
  });

  it("leaves out clients who never completed a visit", async () => {
    await client("Ghost", "+77010000003");
    expect(await topClients(f.business.id, 10)).toHaveLength(0);
  });
});
