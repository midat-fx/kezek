import { and, asc, eq, gte, lt } from "drizzle-orm";
import Link from "next/link";
import { db, schema as s } from "@/db";
import { localTimeToUtc } from "@/lib/slots";
import { requireSession } from "@/lib/session";
import { updateBookingStatus } from "./actions";
import { DatePicker } from "./date-picker";
import { LiveRefresh } from "./live";

const statusStyle: Record<string, string> = {
  confirmed: "border-sky-200 bg-sky-50",
  completed: "border-emerald-200 bg-emerald-50",
  cancelled: "border-zinc-200 bg-zinc-100 opacity-60",
  no_show: "border-red-200 bg-red-50",
};
const statusLabel: Record<string, string> = {
  confirmed: "подтверждена",
  completed: "выполнена",
  cancelled: "отменена",
  no_show: "не пришла",
};

export default async function CalendarPage(ctx: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireSession();
  const [biz] = await db.select().from(s.businesses).where(eq(s.businesses.id, session.businessId));
  const { date } = await ctx.searchParams;
  const dateISO =
    date ??
    new Intl.DateTimeFormat("en-CA", { timeZone: biz.timezone }).format(new Date()); // YYYY-MM-DD today, business-local

  const dayStart = new Date(localTimeToUtc(dateISO, "00:00", biz.timezone));
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  const rows = await db
    .select({
      id: s.bookings.id,
      startAt: s.bookings.startAt,
      endAt: s.bookings.endAt,
      status: s.bookings.status,
      priceKzt: s.bookings.priceKzt,
      staffName: s.staff.name,
      staffId: s.staff.id,
      serviceName: s.services.name,
      clientName: s.clients.name,
      clientPhone: s.clients.phone,
    })
    .from(s.bookings)
    .innerJoin(s.staff, eq(s.bookings.staffId, s.staff.id))
    .innerJoin(s.services, eq(s.bookings.serviceId, s.services.id))
    .innerJoin(s.clients, eq(s.bookings.clientId, s.clients.id))
    .where(
      and(
        eq(s.bookings.businessId, session.businessId),
        gte(s.bookings.startAt, dayStart),
        lt(s.bookings.startAt, dayEnd),
      ),
    )
    .orderBy(asc(s.bookings.startAt));

  const masters = [...new Map(rows.map((r) => [r.staffId, r.staffName]))].map(([id, name]) => ({
    id,
    name,
  }));
  const fmtTime = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: biz.timezone,
  });
  const shift = (days: number) => {
    const d = new Date(dayStart.getTime() + days * 24 * 3600_000 + 12 * 3600_000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: biz.timezone }).format(d);
  };

  return (
    <div>
      <LiveRefresh />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Календарь</h1>
        <div className="flex items-center gap-1">
          <Link href={`/admin?date=${shift(-1)}`} className="rounded-lg border border-zinc-300 bg-white px-2 py-1">
            ←
          </Link>
          <DatePicker value={dateISO} />
          <Link href={`/admin?date=${shift(1)}`} className="rounded-lg border border-zinc-300 bg-white px-2 py-1">
            →
          </Link>
        </div>
        <span className="text-sm text-zinc-500">
          {rows.length} записей · {rows.filter((r) => r.status === "confirmed").length} активных
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-400">
          На {dateISO} записей нет
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {masters.map((m) => (
            <section key={m.id}>
              <h2 className="mb-2 font-medium text-zinc-700">{m.name}</h2>
              <div className="space-y-2">
                {rows
                  .filter((r) => r.staffId === m.id)
                  .map((r) => (
                    <article key={r.id} className={`rounded-xl border p-3 text-sm ${statusStyle[r.status]}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">
                          {fmtTime.format(r.startAt)}–{fmtTime.format(r.endAt)}
                        </span>
                        <span className="text-xs text-zinc-500">{statusLabel[r.status]}</span>
                      </div>
                      <div className="mt-1">{r.serviceName}</div>
                      <div className="text-zinc-600">
                        {r.clientName} · {r.clientPhone} · {r.priceKzt.toLocaleString("ru-RU")} ₸
                      </div>
                      {r.status === "confirmed" && (
                        <div className="mt-2 flex gap-1">
                          {(
                            [
                              ["completed", "✓ Выполнена"],
                              ["no_show", "Не пришла"],
                              ["cancelled", "Отмена"],
                            ] as const
                          ).map(([st, label]) => (
                            <form key={st} action={updateBookingStatus}>
                              <input type="hidden" name="bookingId" value={r.id} />
                              <input type="hidden" name="status" value={st} />
                              <button className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs hover:bg-zinc-50">
                                {label}
                              </button>
                            </form>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
