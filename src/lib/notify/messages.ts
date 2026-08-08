import "server-only";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { channelFor, type Delivery } from "./channels";
import type { ClaimedMessage } from "@/lib/outbox";

type Rendered = Omit<Delivery, "businessId" | "outboxId">;

function fmt(dateMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(dateMs);
}

/** Loads the human-readable context behind a booking id. */
async function bookingContext(bookingId: string) {
  const [row] = await db
    .select({
      startAt: s.bookings.startAt,
      status: s.bookings.status,
      clientName: s.clients.name,
      clientPhone: s.clients.phone,
      serviceName: s.services.name,
      staffName: s.staff.name,
      businessName: s.businesses.name,
      timezone: s.businesses.timezone,
    })
    .from(s.bookings)
    .innerJoin(s.clients, eq(s.bookings.clientId, s.clients.id))
    .innerJoin(s.services, eq(s.bookings.serviceId, s.services.id))
    .innerJoin(s.staff, eq(s.bookings.staffId, s.staff.id))
    .innerJoin(s.businesses, eq(s.bookings.businessId, s.businesses.id))
    .where(eq(s.bookings.id, bookingId));
  return row;
}

/**
 * Renders a queued message. Returning `null` means "no longer relevant" —
 * e.g. a reminder whose booking was cancelled — and the message is retired
 * without an error.
 */
export async function render(msg: ClaimedMessage): Promise<Rendered | null> {
  const payload = msg.payload as Record<string, string>;

  switch (msg.topic) {
    case "booking.confirmed": {
      const b = await bookingContext(payload.bookingId);
      if (!b) return null;
      return {
        channel: "sms",
        recipient: b.clientPhone,
        subject: `${b.businessName}: запись подтверждена`,
        body: `${b.clientName}, вы записаны на «${b.serviceName}» к мастеру ${b.staffName}: ${fmt(b.startAt.getTime(), b.timezone)}.`,
      };
    }

    case "booking.reminder": {
      const b = await bookingContext(payload.bookingId);
      if (!b || b.status !== "confirmed") return null; // cancelled in the meantime
      return {
        channel: "sms",
        recipient: b.clientPhone,
        subject: `${b.businessName}: напоминание`,
        body: `${b.clientName}, напоминаем: «${b.serviceName}» у мастера ${b.staffName} завтра, ${fmt(b.startAt.getTime(), b.timezone)}.`,
      };
    }

    case "booking.cancelled": {
      const b = await bookingContext(payload.bookingId);
      if (!b) return null;
      return {
        channel: "sms",
        recipient: b.clientPhone,
        subject: `${b.businessName}: запись отменена`,
        body: `${b.clientName}, ваша запись на ${fmt(b.startAt.getTime(), b.timezone)} отменена.`,
      };
    }

    default:
      throw new Error(`No renderer for outbox topic "${msg.topic}"`);
  }
}

export async function deliver(msg: ClaimedMessage): Promise<"sent" | "skipped"> {
  const rendered = await render(msg);
  if (!rendered) return "skipped";
  await channelFor(rendered.channel).send({
    ...rendered,
    businessId: msg.businessId,
    outboxId: msg.id,
  });
  return "sent";
}
