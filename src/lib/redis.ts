import Redis from "ioredis";

// Module-level singletons survive HMR in dev via globalThis.
const g = globalThis as unknown as { __redis?: Redis; __redisSub?: Redis };

export function redis(): Redis {
  g.__redis ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 2,
  });
  return g.__redis;
}

// Dedicated connection for pub/sub subscriptions (a subscribing
// ioredis connection can't run regular commands).
export function redisSub(): Redis {
  g.__redisSub ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 2,
  });
  return g.__redisSub;
}
