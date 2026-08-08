import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { staffForService } from "@/lib/booking";
import { businessBySlug, clientIp } from "@/lib/public";
import { rateLimit } from "@/lib/ratelimit";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`catalog:${await clientIp()}`, 60, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const biz = await businessBySlug(slug);
  if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const services = await db
    .select()
    .from(s.services)
    .where(and(eq(s.services.businessId, biz.id), eq(s.services.isActive, true)));
  const withStaff = await Promise.all(
    services.map(async (svc) => ({
      id: svc.id,
      name: svc.name,
      durationMin: svc.durationMin,
      priceKzt: svc.priceKzt,
      staff: await staffForService(biz.id, svc.id),
    })),
  );
  return NextResponse.json({
    business: { name: biz.name, slug: biz.slug, timezone: biz.timezone },
    services: withStaff,
  });
}
