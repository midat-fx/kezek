import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema as s } from "@/db";

export async function businessBySlug(slug: string) {
  return db.query.businesses.findFirst({ where: eq(s.businesses.slug, slug) });
}

export async function clientIp(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
