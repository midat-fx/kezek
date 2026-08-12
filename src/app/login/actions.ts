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
  if (!email || !password) return { error: "Enter an email and a password" };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (!(await rateLimit(`login:${ip}`, 10, 60))) {
    return { error: "Too many attempts, wait a minute" };
  }

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Wrong email or password" };
  }
  if (!user.businessId) return { error: "This user is not attached to a business" };

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
