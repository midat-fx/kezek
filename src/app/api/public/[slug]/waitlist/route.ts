import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { businessBySlug, clientIp } from "@/lib/public";
import { rateLimit } from "@/lib/ratelimit";
import { joinWaitlist } from "@/lib/waitlist";

const body = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^\+?\d{10,15}$/),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`waitlist:${await clientIp()}`, 10, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const biz = await businessBySlug(slug);
  if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { entryId } = await joinWaitlist({
    businessId: biz.id,
    serviceId: parsed.data.serviceId,
    staffId: parsed.data.staffId ?? null,
    dateISO: parsed.data.date,
    client: { name: parsed.data.name, phone: parsed.data.phone },
  });
  return NextResponse.json({ entryId });
}
