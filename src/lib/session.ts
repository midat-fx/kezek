import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { redis } from "./redis";
import { SESSION_COOKIE } from "./session-cookie";

export { SESSION_COOKIE };
const SESSION_TTL_SEC = 7 * 24 * 3600;

export type Session = {
  userId: string;
  businessId: string;
  role: "owner" | "staff";
  name: string;
  email: string;
};

const key = (token: string) => `sess:${token}`;

// Sessions live in Redis: opaque 256-bit token in an httpOnly cookie,
// all session data server-side, TTL-refreshed on each read.
export async function createSession(data: Session): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await redis().set(key(token), JSON.stringify(data), "EX", SESSION_TTL_SEC);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SEC,
    path: "/",
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const raw = await redis().get(key(token));
  if (!raw) return null;
  await redis().expire(key(token), SESSION_TTL_SEC); // sliding expiration
  return JSON.parse(raw) as Session;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await redis().del(key(token));
  store.delete(SESSION_COOKIE);
}
