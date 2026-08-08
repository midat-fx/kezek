import "server-only";
import { redis } from "./redis";

// Fixed-window rate limiter on Redis INCR+EXPIRE.
// ponytail: fixed window is enough here; switch to sliding log if abuse shows up.
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const k = `rl:${bucket}`;
  const n = await redis().incr(k);
  if (n === 1) await redis().expire(k, windowSec);
  return n <= limit;
}
