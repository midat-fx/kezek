"use server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { rateLimit } from "@/lib/ratelimit";
import { createSession, destroySession } from "@/lib/session";

export async function login(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Введите email и пароль" };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (!(await rateLimit(`login:${ip}`, 10, 60))) {
    return { error: "Слишком много попыток, подождите минуту" };
  }

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Неверный email или пароль" };
  }
  if (!user.businessId) return { error: "Пользователь не привязан к бизнесу" };

  await createSession({
    userId: user.id,
    businessId: user.businessId,
    role: user.role,
    name: user.name,
    email: user.email,
  });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
