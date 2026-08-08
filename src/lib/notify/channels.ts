import "server-only";
import { db, schema as s } from "@/db";

export type Delivery = {
  businessId: string;
  outboxId: string | null;
  channel: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
};

export interface Channel {
  readonly name: "email" | "sms";
  send(d: Delivery): Promise<void>;
}

/**
 * The demo transport: records what would have gone out so the admin can see it
 * and tests can assert on it. A real ESP/SMS gateway implements the same
 * interface and swaps in via `channelFor` — nothing else changes.
 */
class RecordingChannel implements Channel {
  constructor(readonly name: "email" | "sms") {}

  async send(d: Delivery): Promise<void> {
    await db.insert(s.messageLog).values({
      businessId: d.businessId,
      outboxId: d.outboxId,
      channel: this.name,
      recipient: d.recipient,
      subject: d.subject,
      body: d.body,
    });
  }
}

const channels: Record<"email" | "sms", Channel> = {
  email: new RecordingChannel("email"),
  sms: new RecordingChannel("sms"),
};

export function channelFor(name: "email" | "sms"): Channel {
  return channels[name];
}

/** Test seam: swap a channel to simulate an outage. Returns a restore fn. */
export function __setChannel(name: "email" | "sms", impl: Channel): () => void {
  const previous = channels[name];
  channels[name] = impl;
  return () => {
    channels[name] = previous;
  };
}
