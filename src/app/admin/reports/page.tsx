import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireSession } from "@/lib/session";
import { RevenueChart } from "./revenue-chart";

export default async function ReportsPage() {
  const session = await requireSession();
  const [biz] = await db.select().from(s.businesses).where(eq(s.businesses.id, session.businessId));
  const since = new Date(Date.now() - 30 * 24 * 3600_000);

  // Revenue per local day, completed bookings, last 30 days
  const revenue = await db
    .select({
      day: sql<string>`to_char(${s.bookings.startAt} at time zone ${biz.timezone}, 'YYYY-MM-DD')`,
      total: sql<number>`sum(${s.bookings.priceKzt})`,
    })
    .from(s.bookings)
    .where(
      and(
        eq(s.bookings.businessId, session.businessId),
        eq(s.bookings.status, "completed"),
        gte(s.bookings.startAt, since),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byService = await db
    .select({
      name: s.services.name,
      count: sql<number>`count(*)`,
      total: sql<number>`sum(${s.bookings.priceKzt})`,
    })
    .from(s.bookings)
    .innerJoin(s.services, eq(s.bookings.serviceId, s.services.id))
    .where(
      and(
        eq(s.bookings.businessId, session.businessId),
        eq(s.bookings.status, "completed"),
        gte(s.bookings.startAt, since),
      ),
    )
    .groupBy(s.services.name)
    .orderBy(desc(sql`sum(${s.bookings.priceKzt})`));

  const [counts] = await db
    .select({
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      noShow: sql<number>`count(*) filter (where status = 'no_show')`,
      cancelled: sql<number>`count(*) filter (where status = 'cancelled')`,
      upcoming: sql<number>`count(*) filter (where status = 'confirmed')`,
      revenue: sql<number>`coalesce(sum(price_kzt) filter (where status = 'completed'), 0)`,
    })
    .from(s.bookings)
    .where(and(eq(s.bookings.businessId, session.businessId), gte(s.bookings.startAt, since)));

  const noShowRate =
    Number(counts.completed) + Number(counts.noShow) > 0
      ? Math.round((100 * Number(counts.noShow)) / (Number(counts.completed) + Number(counts.noShow)))
      : 0;

  const tiles = [
    ["Выручка 30 дней", `${Number(counts.revenue).toLocaleString("ru-RU")} ₸`],
    ["Выполнено", counts.completed],
    ["Предстоит", counts.upcoming],
    ["No-show", `${counts.noShow} (${noShowRate}%)`],
  ] as const;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Отчёты · 30 дней</h1>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="text-sm text-zinc-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-zinc-700">Выручка по дням</h2>
        <RevenueChart data={revenue.map((r) => ({ day: r.day.slice(5), total: Number(r.total) }))} />
      </section>

      <section className="max-w-xl rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-zinc-700">По услугам</h2>
        <table className="w-full text-sm">
          <tbody>
            {byService.map((r) => (
              <tr key={r.name} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{r.name}</td>
                <td className="py-2 text-right text-zinc-500">{r.count}×</td>
                <td className="py-2 text-right font-medium">
                  {Number(r.total).toLocaleString("ru-RU")} ₸
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
