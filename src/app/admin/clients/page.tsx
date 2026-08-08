import { desc, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireSession } from "@/lib/session";

export default async function ClientsPage() {
  const session = await requireSession();
  const rows = await db
    .select({
      id: s.clients.id,
      name: s.clients.name,
      phone: s.clients.phone,
      visits: sql<number>`count(*) filter (where ${s.bookings.status} = 'completed')`,
      noShows: sql<number>`count(*) filter (where ${s.bookings.status} = 'no_show')`,
      spentKzt: sql<number>`coalesce(sum(${s.bookings.priceKzt}) filter (where ${s.bookings.status} = 'completed'), 0)`,
    })
    .from(s.clients)
    .leftJoin(s.bookings, eq(s.bookings.clientId, s.clients.id))
    .where(eq(s.clients.businessId, session.businessId))
    .groupBy(s.clients.id)
    .orderBy(desc(sql`count(*)`));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Клиенты · {rows.length}</h1>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500">
            <tr>
              <th className="p-3">Имя</th>
              <th className="p-3">Телефон</th>
              <th className="p-3 text-right">Визитов</th>
              <th className="p-3 text-right">Не пришла</th>
              <th className="p-3 text-right">Потрачено</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-zinc-600">{c.phone}</td>
                <td className="p-3 text-right">{c.visits}</td>
                <td className={`p-3 text-right ${Number(c.noShows) > 0 ? "text-red-600" : ""}`}>
                  {c.noShows}
                </td>
                <td className="p-3 text-right">{Number(c.spentKzt).toLocaleString("ru-RU")} ₸</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
