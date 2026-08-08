import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHold, getAvailability } from "@/lib/booking";
import { businessBySlug, clientIp } from "@/lib/public";
import { rateLimit } from "@/lib/ratelimit";

const body = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMs: z.number().int(),
});

// Places a short-lived Redis hold on a slot (like a cart reservation)
// so the client can fill in contact details without losing the time.
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`hold:${await clientIp()}`, 20, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const biz = await businessBySlug(slug);
  if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The slot must be genuinely available right now (endMs comes from the
  // server-computed grid, never from the client).
  const slots = await getAvailability({
    businessId: biz.id,
    timeZone: biz.timezone,
    staffId: parsed.data.staffId,
    serviceId: parsed.data.serviceId,
    dateISO: parsed.data.date,
  });
  const slot = slots.find((sl) => sl.startMs === parsed.data.startMs);
  if (!slot) return NextResponse.json({ error: "slot_unavailable" }, { status: 409 });

  const token = await createHold(parsed.data.staffId, slot, biz.holdTtlSec);
  if (!token) return NextResponse.json({ error: "slot_unavailable" }, { status: 409 });
  return NextResponse.json({ holdToken: token, expiresInSec: biz.holdTtlSec, slot });
}
