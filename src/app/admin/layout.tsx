import Link from "next/link";
import { requireSession } from "@/lib/session";
import { logout } from "@/app/login/actions";

const nav = [
  ["/admin", "Календарь"],
  ["/admin/clients", "Клиенты"],
  ["/admin/services", "Услуги"],
  ["/admin/staff", "Мастера"],
  ["/admin/reports", "Отчёты"],
  ["/admin/notifications", "Уведомления"],
  ["/admin/audit", "Журнал"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6 overflow-x-auto">
            <span className="text-lg font-bold">kezek</span>
            <nav className="flex gap-4 text-sm">
              {nav.map(([href, label]) => (
                <Link key={href} href={href} className="whitespace-nowrap text-zinc-600 hover:text-zinc-900">
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={logout} className="flex items-center gap-3 text-sm">
            <span className="hidden text-zinc-500 sm:inline">{session.name}</span>
            <button className="rounded-lg border border-zinc-300 px-3 py-1 hover:bg-zinc-100">Выйти</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
