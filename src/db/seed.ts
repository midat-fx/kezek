import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as s from "./schema";

// Deterministic demo dataset: one salon in Almaty, 3 masters, 5 services,
// clients and a spread of past/future bookings so the reports page has data.
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: s });

  // Idempotent: wipe and re-seed.
  await db.delete(s.messageLog);
  await db.delete(s.outbox);
  await db.delete(s.waitlistEntries);
  await db.delete(s.auditLog);
  await db.delete(s.bookings);
  await db.delete(s.clients);
  await db.delete(s.staffServices);
  await db.delete(s.staffHours);
  await db.delete(s.services);
  await db.delete(s.staff);
  await db.delete(s.businessHours);
  await db.delete(s.users);
  await db.delete(s.businesses);

  const [biz] = await db
    .insert(s.businesses)
    .values({ slug: "aruzhan", name: "Aruzhan Beauty", timezone: "Asia/Almaty" })
    .returning();

  // Tue–Sun 10:00–20:00, Monday closed
  await db.insert(s.businessHours).values(
    [2, 3, 4, 5, 6, 7].map((weekday) => ({
      businessId: biz.id,
      weekday,
      openTime: "10:00",
      closeTime: "20:00",
    })),
  );

  const passwordHash = await bcrypt.hash("kezek-demo", 10);
  await db.insert(s.users).values({
    email: "owner@kezek.dev",
    passwordHash,
    name: "Aruzhan",
    role: "owner",
    businessId: biz.id,
  });

  const masters = await db
    .insert(s.staff)
    .values([
      { businessId: biz.id, name: "Dana" },
      { businessId: biz.id, name: "Madina" },
      { businessId: biz.id, name: "Aliya" },
    ])
    .returning();

  // Aliya works short days
  await db.insert(s.staffHours).values(
    [2, 3, 4, 5, 6].map((weekday) => ({
      staffId: masters[2].id,
      weekday,
      startTime: "12:00",
      endTime: "18:00",
    })),
  );

  const svc = await db
    .insert(s.services)
    .values([
      { businessId: biz.id, name: "Women's haircut", durationMin: 60, priceKzt: 8000 },
      { businessId: biz.id, name: "Men's haircut", durationMin: 45, priceKzt: 5000 },
      { businessId: biz.id, name: "Hair coloring", durationMin: 120, priceKzt: 25000 },
      { businessId: biz.id, name: "Manicure", durationMin: 90, priceKzt: 12000 },
      { businessId: biz.id, name: "Blow-dry", durationMin: 40, priceKzt: 6000 },
    ])
    .returning();

  await db.insert(s.staffServices).values([
    { staffId: masters[0].id, serviceId: svc[0].id },
    { staffId: masters[0].id, serviceId: svc[1].id },
    { staffId: masters[0].id, serviceId: svc[4].id },
    { staffId: masters[1].id, serviceId: svc[0].id },
    { staffId: masters[1].id, serviceId: svc[2].id },
    { staffId: masters[1].id, serviceId: svc[4].id },
    { staffId: masters[2].id, serviceId: svc[3].id },
  ]);

  const names = [
    ["Aida", "+77011234501"],
    ["Zhanna", "+77011234502"],
    ["Karina", "+77011234503"],
    ["Saule", "+77011234504"],
    ["Inkar", "+77011234505"],
    ["Tomiris", "+77011234506"],
    ["Assel", "+77011234507"],
    ["Diana", "+77011234508"],
  ] as const;
  const cls = await db
    .insert(s.clients)
    .values(names.map(([name, phone]) => ({ businessId: biz.id, name, phone })))
    .returning();

  // Bookings from 3 weeks ago through 3 days ahead, so a fresh clone opens on
  // a day that actually has something in it. Past ones are settled
  // (completed / the occasional no-show), future ones are still confirmed.
  // All times UTC; Almaty is UTC+5, so 05:00Z = 10:00 local.
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const rows: (typeof s.bookings.$inferInsert)[] = [];
  let i = 0;
  for (let d = 21; d >= -3; d--) {
    const base = new Date(now - d * day);
    if (base.getUTCDay() === 1) continue; // Monday closed
    // 2-4 bookings per day, alternating masters/services
    const perDay = 2 + ((Math.abs(d) * 7) % 3);
    for (let k = 0; k < perDay; k++) {
      const master = masters[(i + k) % 2]; // Dana/Madina work full days
      const service = svc.filter((v, idx) => [0, 1, 2, 4].includes(idx))[(i + k) % 4];
      const startHourUtc = 5 + k * 3; // 10:00, 13:00, 16:00, 19:00 local
      const start = new Date(base);
      start.setUTCHours(startHourUtc, 0, 0, 0);
      const end = new Date(start.getTime() + service.durationMin * 60000);
      const isPast = end.getTime() < now;
      const noShow = isPast && (i + k) % 9 === 0;
      rows.push({
        businessId: biz.id,
        staffId: master.id,
        serviceId: service.id,
        clientId: cls[(i + k) % cls.length].id,
        startAt: start,
        endAt: end,
        status: noShow ? "no_show" : isPast ? "completed" : "confirmed",
        priceKzt: service.priceKzt,
      });
      i++;
    }
  }
  const inserted = await db.insert(s.bookings).values(rows).returning();

  // Queue the messages the upcoming bookings would have produced, so the
  // notifications page has something to show and `pnpm worker` has work to do.
  const upcoming = inserted.filter((b) => b.status === "confirmed");
  if (upcoming.length > 0) {
    await db.insert(s.outbox).values(
      upcoming.flatMap((b) => [
        {
          businessId: biz.id,
          topic: "booking.confirmed",
          payload: { bookingId: b.id },
          dedupeKey: `booking.confirmed:${b.id}`,
        },
        {
          businessId: biz.id,
          topic: "booking.reminder",
          payload: { bookingId: b.id },
          dedupeKey: `booking.reminder:${b.id}`,
          availableAt: new Date(b.startAt.getTime() - 24 * 3600_000),
        },
      ]),
    );
  }

  console.log(`Seeded: business=${biz.slug}, staff=${masters.length}, services=${svc.length}, clients=${cls.length}, bookings=${rows.length}`);
  console.log("Admin login: owner@kezek.dev / kezek-demo");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
