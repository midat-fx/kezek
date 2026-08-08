import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createBooking } from "@/lib/booking";
import { businessBySlug, clientIp } from "@/lib/public";
import { rateLimit } from "@/lib/ratelimit";

const body = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  startMs: z.number().int(),
  endMs: z.number().int(),
  holdToken: z.string().min(16),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^\+?\d{10,15}$/),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`book:${await clientIp()}`, 10, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const biz = await businessBySlug(slug);
  if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { serviceId, staffId, startMs, endMs, holdToken, name, phone } = parsed.data;
  const result = await createBooking({
    businessId: biz.id,
    staffId,
    serviceId,
    slot: { startMs, endMs },
    holdToken,
    client: { name, phone },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ bookingId: result.bookingId });
}
