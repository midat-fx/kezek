import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Tx } from "@/db";

export type OutboxMessage = {
  businessId: string;
  topic: string;
  payload: Record<string, unknown>;
  /** Natural key; a second enqueue with the same key is a no-op. */
  dedupeKey?: string;
  /** Delay delivery until this instant (reminders, offers with a deadline). */
  availableAt?: Date;
  maxAttempts?: number;
};

/**
 * Enqueue inside the caller's transaction. Never call this with the global
 * `db` when a business row is being written — that is the whole point of the
 * pattern: message and change commit together or not at all.
 */
export async function enqueue(tx: Tx, msg: OutboxMessage): Promise<void> {
  await tx
    .insert(s.outbox)
    .values({
      businessId: msg.businessId,
      topic: msg.topic,
      payload: msg.payload,
      dedupeKey: msg.dedupeKey ?? null,
      availableAt: msg.availableAt ?? new Date(),
      maxAttempts: msg.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: s.outbox.dedupeKey });
}

/** Drop a scheduled message that is no longer wanted (booking cancelled…). */
export async function cancelByDedupeKey(tx: Tx, dedupeKey: string): Promise<void> {
  await tx
    .update(s.outbox)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(s.outbox.dedupeKey, dedupeKey), eq(s.outbox.status, "pending")));
}

export type ClaimedMessage = typeof s.outbox.$inferSelect;

/** How long a claimed message stays reserved before another worker may retry it. */
export const LEASE_SEC = 60;

/** Raw SQL returns snake_case columns; drizzle's select does not. Bridge them. */
type OutboxRow = {
  id: string;
  business_id: string;
  topic: string;
  payload: unknown;
  dedupe_key: string | null;
  available_at: Date;
  status: (typeof s.outboxStatuses)[number];
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

const toMessage = (r: OutboxRow): ClaimedMessage => ({
  id: r.id,
  businessId: r.business_id,
  topic: r.topic,
  payload: r.payload,
  dedupeKey: r.dedupe_key,
  availableAt: r.available_at,
  status: r.status,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  lastError: r.last_error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Atomically claim up to `limit` due messages.
 *
 * Two mechanisms, doing different jobs:
 *  - FOR UPDATE SKIP LOCKED keeps simultaneous claimers off each other's rows
 *    inside the statement — a locked row is invisible rather than blocking.
 *  - Flipping the row to 'processing' with `available_at` pushed out by
 *    LEASE_SEC keeps it claimed *after* the statement commits. Row locks end
 *    with the statement; without the lease a second worker a millisecond later
 *    would happily claim the same message again.
 *
 * The lease doubles as crash recovery: a worker that dies mid-delivery leaves
 * the row reserved only until the lease lapses, then it is retried.
 */
export async function claim(limit: number): Promise<ClaimedMessage[]> {
  const { rows } = await db.execute<OutboxRow>(sql`
    WITH due AS (
      SELECT id FROM outbox
      WHERE status IN ('pending', 'processing') AND available_at <= now()
      ORDER BY available_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE outbox o
    SET attempts    = o.attempts + 1,
        status      = 'processing',
        available_at = now() + (${LEASE_SEC} || ' seconds')::interval,
        updated_at  = now()
    FROM due
    WHERE o.id = due.id
    RETURNING o.*
  `);
  return rows.map(toMessage);
}

export async function markSent(id: string): Promise<void> {
  await db
    .update(s.outbox)
    .set({ status: "sent", updatedAt: new Date(), lastError: null })
    .where(eq(s.outbox.id, id));
}

/** Exponential backoff: 2s, 4s, 8s, 16s… then give up and mark it dead. */
export async function markFailed(msg: ClaimedMessage, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = msg.attempts >= msg.maxAttempts;
  await db
    .update(s.outbox)
    .set({
      status: exhausted ? "dead" : "pending",
      lastError: message.slice(0, 1000),
      availableAt: new Date(Date.now() + 2 ** msg.attempts * 1000),
      updatedAt: new Date(),
    })
    .where(eq(s.outbox.id, msg.id));
}
