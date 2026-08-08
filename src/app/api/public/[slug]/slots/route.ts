import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAvailability } from "@/lib/booking";
import { businessBySlug, clientIp } from "@/lib/public";
import { rateLimit } from "@/lib/ratelimit";

const query = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`slots:${await clientIp()}`, 120, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const biz = await businessBySlug(slug);
  if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const slots = await getAvailability({
    businessId: biz.id,
    timeZone: biz.timezone,
    staffId: parsed.data.staffId,
    serviceId: parsed.data.serviceId,
    dateISO: parsed.data.date,
  });
  return NextResponse.json({ slots });
}
