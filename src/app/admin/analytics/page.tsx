import { cohorts, revenueTrend, topClients, utilization } from "@/lib/analytics";
import { requireSession } from "@/lib/session";
import { TrendChart } from "./trend-chart";

const kzt = (n: number) => `${n.toLocaleString("en-GB")} ₸`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function AnalyticsPage() {
  const session = await requireSession();
  const [trend, util, cohortRows, clients] = await Promise.all([
    revenueTrend(session.businessId, 30),
    utilization(session.businessId, 30),
    cohorts(session.businessId, 6),
    topClients(session.businessId, 10),
  ]);

  const widest = Math.max(1, ...cohortRows.map((c) => c.retained.length));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Postgres window functions: trailing mean, running total, ranks and cohorts.
        </p>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-1 font-medium text-zinc-700">Revenue, last 30 days</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Bars are daily actuals; the line is a 7-day trailing mean, which smooths the weekly saw-tooth.
        </p>
        <TrendChart data={trend} />
      </section>

      <section>
        <h2 className="mb-2 font-medium text-zinc-700">Staff utilization · 30 days</h2>
        <div className="space-y-2">
          {util.map((u) => (
            <div key={u.staffId} className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{u.staffName}</span>
                <span className="text-zinc-500">
                  {Math.round(u.bookedMinutes / 60)} h of {Math.round(u.availableMinutes / 60)} h ·{" "}
                  {kzt(u.revenue)}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-zinc-900"
                  style={{ width: `${Math.min(100, u.utilization * 100)}%` }}
                />
              </div>
              <div className="mt-1 text-right text-xs text-zinc-500">{pct(u.utilization)}</div>
            </div>
          ))}
          {util.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-400">
              No active staff
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-zinc-700">Cohort retention</h2>
        <p className="mb-2 text-xs text-zinc-500">
          Each row is a month of first visit; each column, how many of them came back N months later.
        </p>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-zinc-500">
              <tr>
                <th className="p-3">Cohort</th>
                <th className="p-3 text-right">Clients</th>
                {Array.from({ length: widest }, (_, i) => (
                  <th key={i} className="p-3 text-right">
                    +{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohortRows.map((c) => (
                <tr key={c.cohort} className="border-b border-zinc-100 last:border-0">
                  <td className="p-3 font-medium">{c.cohort}</td>
                  <td className="p-3 text-right">{c.size}</td>
                  {Array.from({ length: widest }, (_, i) => {
                    const n = c.retained[i] ?? 0;
                    const share = c.size > 0 ? n / c.size : 0;
                    return (
                      <td
                        key={i}
                        className="p-3 text-right"
                        style={{ backgroundColor: n ? `rgba(24,24,27,${0.06 + share * 0.5})` : undefined }}
                      >
                        {n || "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {cohortRows.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-zinc-400" colSpan={2 + widest}>
                    No completed visits yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-zinc-700">Top clients</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-zinc-500">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Client</th>
                <th className="p-3 text-right">Visits</th>
                <th className="p-3 text-right">Revenue</th>
                <th className="p-3 text-right">Cumulative share</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.phone} className="border-b border-zinc-100 last:border-0">
                  <td className="p-3 text-zinc-400">{c.rank}</td>
                  <td className="p-3 font-medium">
                    {c.name} <span className="font-normal text-zinc-500">{c.phone}</span>
                  </td>
                  <td className="p-3 text-right">{c.visits}</td>
                  <td className="p-3 text-right">{kzt(c.revenue)}</td>
                  <td className="p-3 text-right text-zinc-500">{pct(c.cumulativeShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
