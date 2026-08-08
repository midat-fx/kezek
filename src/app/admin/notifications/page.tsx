import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireSession } from "@/lib/session";

const statusStyle: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-sky-100 text-sky-800",
  sent: "bg-emerald-100 text-emerald-800",
  dead: "bg-red-100 text-red-800",
  cancelled: "bg-zinc-200 text-zinc-600",
};

export default async function NotificationsPage() {
  const session = await requireSession();

  const queue = await db
    .select()
    .from(s.outbox)
    .where(eq(s.outbox.businessId, session.businessId))
    .orderBy(desc(s.outbox.createdAt))
    .limit(50);

  const delivered = await db
    .select()
    .from(s.messageLog)
    .where(eq(s.messageLog.businessId, session.businessId))
    .orderBy(desc(s.messageLog.createdAt))
    .limit(50);

  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });
  const counts = queue.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Уведомления</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Сообщения кладутся в очередь в той же транзакции, что и сама бронь, и уходят отдельным
          воркером (<code className="rounded bg-zinc-100 px-1">pnpm worker</code>).
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {Object.entries(counts).map(([status, n]) => (
          <span key={status} className={`rounded-full px-3 py-1 ${statusStyle[status]}`}>
            {status}: {n}
          </span>
        ))}
        {queue.length === 0 && <span className="text-zinc-400">Очередь пуста</span>}
      </div>

      <section>
        <h2 className="mb-2 font-medium text-zinc-700">Очередь</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-zinc-500">
              <tr>
                <th className="p-3">Тема</th>
                <th className="p-3">Статус</th>
                <th className="p-3 text-right">Попыток</th>
                <th className="p-3">Отправить в</th>
                <th className="p-3">Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                  <td className="p-3 font-mono text-xs">{r.topic}</td>
                  <td className="p-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${statusStyle[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {r.attempts}/{r.maxAttempts}
                  </td>
                  <td className="p-3 text-zinc-500">{fmt.format(r.availableAt)}</td>
                  <td className="max-w-60 truncate p-3 text-xs text-red-600">{r.lastError}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-zinc-700">Доставлено</h2>
        <div className="space-y-2">
          {delivered.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-400">
              Пока ничего не отправлено — запустите <code>pnpm worker</code>
            </p>
          )}
          {delivered.map((m) => (
            <article key={m.id} className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs uppercase">{m.channel}</span>
                <span className="font-medium">{m.subject}</span>
                <span className="text-zinc-500">→ {m.recipient}</span>
                <span className="ml-auto text-xs text-zinc-400">{fmt.format(m.createdAt)}</span>
              </div>
              <p className="mt-1 text-zinc-600">{m.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
