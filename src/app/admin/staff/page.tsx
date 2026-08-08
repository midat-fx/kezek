import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireSession } from "@/lib/session";
import { saveStaff, toggleStaff, toggleStaffService } from "../actions";

export default async function StaffPage() {
  const session = await requireSession();
  const masters = await db
    .select()
    .from(s.staff)
    .where(eq(s.staff.businessId, session.businessId))
    .orderBy(asc(s.staff.name));
  const services = await db
    .select()
    .from(s.services)
    .where(eq(s.services.businessId, session.businessId))
    .orderBy(asc(s.services.name));
  const links = await db.select().from(s.staffServices);
  const linked = new Set(links.map((l) => `${l.staffId}:${l.serviceId}`));

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Мастера</h1>
      <div className="space-y-3">
        {masters.map((m) => (
          <div key={m.id} className={`rounded-xl border border-zinc-200 bg-white p-4 ${m.isActive ? "" : "opacity-50"}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{m.name}</span>
              <form action={toggleStaff}>
                <input type="hidden" name="id" value={m.id} />
                <button className="rounded-lg border border-zinc-300 px-3 py-1 text-sm">
                  {m.isActive ? "Скрыть" : "Вернуть"}
                </button>
              </form>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {services.map((svc) => {
                const on = linked.has(`${m.id}:${svc.id}`);
                return (
                  <form key={svc.id} action={toggleStaffService}>
                    <input type="hidden" name="staffId" value={m.id} />
                    <input type="hidden" name="serviceId" value={svc.id} />
                    <button
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-500 hover:border-zinc-500"
                      }`}
                    >
                      {svc.name}
                    </button>
                  </form>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-6 mb-2 font-medium text-zinc-700">Новый мастер</h2>
      <form action={saveStaff} className="flex gap-2 rounded-xl border border-dashed border-zinc-300 p-3">
        <input name="name" placeholder="Имя" required className="flex-1 rounded-lg border border-zinc-300 px-2 py-1" />
        <button className="rounded-lg bg-zinc-900 px-3 py-1 text-sm text-white">Добавить</button>
      </form>
    </div>
  );
}
