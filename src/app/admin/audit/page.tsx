import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireSession } from "@/lib/session";

export default async function AuditPage() {
  const session = await requireSession();
  const rows = await db
    .select({
      id: s.auditLog.id,
      action: s.auditLog.action,
      entity: s.auditLog.entity,
      meta: s.auditLog.meta,
      createdAt: s.auditLog.createdAt,
      actor: s.users.name,
    })
    .from(s.auditLog)
    .leftJoin(s.users, eq(s.auditLog.actorUserId, s.users.id))
    .where(eq(s.auditLog.businessId, session.businessId))
    .orderBy(desc(s.auditLog.createdAt))
    .limit(100);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "medium" });
  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Audit log</h1>
      <div className="rounded-xl border border-zinc-200 bg-white">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-baseline gap-2 border-b border-zinc-100 p-3 text-sm last:border-0">
            <span className="text-zinc-400">{fmt.format(r.createdAt)}</span>
            <span className="font-mono font-medium">{r.action}</span>
            <span className="text-zinc-500">{r.actor ?? "client (online)"}</span>
            {r.meta != null && (
              <span className="truncate text-xs text-zinc-400">{JSON.stringify(r.meta)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
