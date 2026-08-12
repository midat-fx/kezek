import Redis from "ioredis";

// Module-level singletons survive HMR in dev via globalThis.
const g = globalThis as unknown as { __redis?: Redis; __redisSub?: Redis };

// Managed Redis add-ons inject the URL under their own name — Upstash on
// Vercel sets KV_URL alongside REDIS_URL — so accept either.
const URL_ = process.env.REDIS_URL ?? process.env.KV_URL ?? "redis://localhost:6379";

export function redis(): Redis {
  g.__redis ??= new Redis(URL_, {
    maxRetriesPerRequest: 2,
  });
  return g.__redis;
}

// Dedicated connection for pub/sub subscriptions (a subscribing
// ioredis connection can't run regular commands).
export function redisSub(): Redis {
  g.__redisSub ??= new Redis(URL_, {
    maxRetriesPerRequest: 2,
  });
  return g.__redisSub;
}
