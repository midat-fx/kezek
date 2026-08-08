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
      { businessId: biz.id, name: "Женская стрижка", durationMin: 60, priceKzt: 8000 },
      { businessId: biz.id, name: "Мужская стрижка", durationMin: 45, priceKzt: 5000 },
      { businessId: biz.id, name: "Окрашивание", durationMin: 120, priceKzt: 25000 },
      { businessId: biz.id, name: "Маникюр", durationMin: 90, priceKzt: 12000 },
      { businessId: biz.id, name: "Укладка", durationMin: 40, priceKzt: 6000 },
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
    ["Аида", "+77011234501"],
    ["Жанна", "+77011234502"],
    ["Карина", "+77011234503"],
    ["Сауле", "+77011234504"],
    ["Инкар", "+77011234505"],
    ["Томирис", "+77011234506"],
    ["Асель", "+77011234507"],
    ["Диана", "+77011234508"],
  ] as const;
  const cls = await db
    .insert(s.clients)
    .values(names.map(([name, phone]) => ({ businessId: biz.id, name, phone })))
    .returning();

  // Bookings: 3 weeks back (completed / some no-shows) + a few upcoming.
  // All times UTC; Almaty is UTC+5, so 05:00Z = 10:00 local.
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const rows: (typeof s.bookings.$inferInsert)[] = [];
  let i = 0;
  for (let d = 21; d >= 1; d--) {
    const base = new Date(now - d * day);
    if (base.getUTCDay() === 1) continue; // Monday closed
    // 2-4 bookings per day, alternating masters/services
    const perDay = 2 + ((d * 7) % 3);
    for (let k = 0; k < perDay; k++) {
      const master = masters[(i + k) % 2]; // Dana/Madina full day
      const service = svc.filter((v, idx) => [0, 1, 2, 4].includes(idx))[(i + k) % 4];
      const startHourUtc = 5 + k * 3; // 10:00, 13:00, 16:00, 19:00 local
      const start = new Date(base);
      start.setUTCHours(startHourUtc, 0, 0, 0);
      const end = new Date(start.getTime() + service.durationMin * 60000);
      const noShow = (i + k) % 9 === 0;
      rows.push({
        businessId: biz.id,
        staffId: master.id,
        serviceId: service.id,
        clientId: cls[(i + k) % cls.length].id,
        startAt: start,
        endAt: end,
        status: noShow ? "no_show" : "completed",
        priceKzt: service.priceKzt,
      });
      i++;
    }
  }
  // Upcoming confirmed bookings (skip Mondays)
  for (let d = 1; d <= 3; d++) {
    const base = new Date(now + d * day);
    if (base.getUTCDay() === 1) continue;
    const service = svc[d % 3];
    const start = new Date(base);
    start.setUTCHours(6 + d, 0, 0, 0);
    rows.push({
      businessId: biz.id,
      staffId: masters[d % 2].id,
      serviceId: service.id,
      clientId: cls[d].id,
      startAt: start,
      endAt: new Date(start.getTime() + service.durationMin * 60000),
      status: "confirmed",
      priceKzt: service.priceKzt,
    });
  }
  await db.insert(s.bookings).values(rows);

  console.log(`Seeded: business=${biz.slug}, staff=${masters.length}, services=${svc.length}, clients=${cls.length}, bookings=${rows.length}`);
  console.log("Admin login: owner@kezek.dev / kezek-demo");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
