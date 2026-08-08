import "server-only";
import { claim, markFailed, markSent } from "@/lib/outbox";
import { deliver } from "./messages";

export type DrainResult = { claimed: number; sent: number; skipped: number; failed: number };

/**
 * Processes one batch. Safe to run concurrently on any number of instances —
 * `claim` hands each row to exactly one worker (FOR UPDATE SKIP LOCKED).
 */
export async function drainOnce(batchSize = 20): Promise<DrainResult> {
  const messages = await claim(batchSize);
  const result: DrainResult = { claimed: messages.length, sent: 0, skipped: 0, failed: 0 };

  for (const msg of messages) {
    try {
      const outcome = await deliver(msg);
      await markSent(msg.id);
      if (outcome === "sent") result.sent++;
      else result.skipped++;
    } catch (error) {
      await markFailed(msg, error);
      result.failed++;
    }
  }
  return result;
}

/** Long-running loop for `pnpm worker`. */
export async function runWorker(intervalMs = 2000): Promise<never> {
  for (;;) {
    try {
      const r = await drainOnce();
      if (r.claimed > 0) {
        console.log(
          JSON.stringify({ at: new Date().toISOString(), component: "outbox-worker", ...r }),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          component: "outbox-worker",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
