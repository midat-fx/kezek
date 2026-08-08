import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireSession } from "@/lib/session";
import { saveService, toggleService } from "../actions";

export default async function ServicesPage() {
  const session = await requireSession();
  const rows = await db
    .select()
    .from(s.services)
    .where(eq(s.services.businessId, session.businessId))
    .orderBy(asc(s.services.name));

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Услуги</h1>
      <div className="space-y-2">
        {rows.map((svc) => (
          <form
            key={svc.id}
            action={saveService}
            className={`flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 ${svc.isActive ? "" : "opacity-50"}`}
          >
            <input type="hidden" name="id" value={svc.id} />
            <input name="name" defaultValue={svc.name} className="min-w-40 flex-1 rounded-lg border border-zinc-300 px-2 py-1" />
            <input name="durationMin" type="number" defaultValue={svc.durationMin} min={5} step={5} className="w-20 rounded-lg border border-zinc-300 px-2 py-1" />
            <span className="text-sm text-zinc-400">мин</span>
            <input name="priceKzt" type="number" defaultValue={svc.priceKzt} min={0} step={500} className="w-28 rounded-lg border border-zinc-300 px-2 py-1" />
            <span className="text-sm text-zinc-400">₸</span>
            <button className="rounded-lg bg-zinc-900 px-3 py-1 text-sm text-white">Сохранить</button>
            <button formAction={toggleService} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm">
              {svc.isActive ? "Скрыть" : "Вернуть"}
            </button>
          </form>
        ))}
      </div>

      <h2 className="mt-6 mb-2 font-medium text-zinc-700">Новая услуга</h2>
      <form action={saveService} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-zinc-300 p-3">
        <input name="name" placeholder="Название" required className="min-w-40 flex-1 rounded-lg border border-zinc-300 px-2 py-1" />
        <input name="durationMin" type="number" placeholder="60" required min={5} step={5} className="w-20 rounded-lg border border-zinc-300 px-2 py-1" />
        <span className="text-sm text-zinc-400">мин</span>
        <input name="priceKzt" type="number" placeholder="8000" required min={0} step={500} className="w-28 rounded-lg border border-zinc-300 px-2 py-1" />
        <span className="text-sm text-zinc-400">₸</span>
        <button className="rounded-lg bg-zinc-900 px-3 py-1 text-sm text-white">Добавить</button>
      </form>
    </div>
  );
}
