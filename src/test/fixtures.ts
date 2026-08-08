import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { redis } from "@/lib/redis";
import { localTimeToUtc } from "@/lib/slots";

export type Fixture = Awaited<ReturnType<typeof seedBusiness>>;

/** Wipes every table and the test Redis index. Call in `beforeEach`. */
export async function resetAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE audit_log, bookings, clients, staff_services, staff_hours, services, staff, business_hours, users, businesses RESTART IDENTITY CASCADE`,
  );
  await redis().flushdb();
}

/**
 * One business, open every day 10:00-20:00 local, one master, one 60-minute
 * service. Deliberately minimal — tests add what they need on top.
 */
export async function seedBusiness(opts?: { slug?: string; timezone?: string }) {
  const [business] = await db
    .insert(s.businesses)
    .values({
      slug: opts?.slug ?? "testsalon",
      name: "Test Salon",
      timezone: opts?.timezone ?? "Asia/Almaty",
      holdTtlSec: 300,
    })
    .returning();

  await db.insert(s.businessHours).values(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      businessId: business.id,
      weekday,
      openTime: "10:00",
      closeTime: "20:00",
    })),
  );

  const [owner] = await db
    .insert(s.users)
    .values({
      email: `owner@${business.slug}.test`,
      passwordHash: await bcrypt.hash("test-password", 4), // low cost: tests, not production
      name: "Owner",
      role: "owner",
      businessId: business.id,
    })
    .returning();

  const [master] = await db
    .insert(s.staff)
    .values({ businessId: business.id, name: "Master" })
    .returning();

  const [service] = await db
    .insert(s.services)
    .values({
      businessId: business.id,
      name: "Haircut",
      durationMin: 60,
      priceKzt: 8000,
    })
    .returning();

  await db.insert(s.staffServices).values({ staffId: master.id, serviceId: service.id });

  return { business, owner, master, service };
}

/** A local date far enough ahead that "hide past slots" never interferes. */
export function futureDateISO(daysAhead = 7): string {
  const d = new Date(Date.now() + daysAhead * 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}

/** UTC instant of `HH:MM` local time on `dateISO` at the business. */
export function atLocal(dateISO: string, hhmm: string, timeZone: string): number {
  return localTimeToUtc(dateISO, hhmm, timeZone);
}
