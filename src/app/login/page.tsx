"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <form
        action={action}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">kezek</h1>
          <p className="mt-1 text-sm text-zinc-500">Вход для владельца и мастеров</p>
        </div>
        <label className="block text-sm">
          <span className="text-zinc-700">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 outline-none focus:border-zinc-900"
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">Пароль</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 outline-none focus:border-zinc-900"
          />
        </label>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button
          disabled={pending}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white transition hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Входим…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
