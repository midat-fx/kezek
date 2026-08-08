# Deploy

Free tiers cover this app entirely: Vercel (hosting), Neon (Postgres), Upstash (Redis). Total cost $0/month.

## 1. Database — Neon

1. Create a project at [neon.tech](https://neon.tech) (region: any, e.g. `eu-central-1`).
2. Copy the **pooled** connection string — it looks like
   `postgres://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
3. Enable the extension the overlap constraint needs, in Neon's SQL editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ```
   (Migration `0001` also does this, but Neon sometimes needs it on the branch first.)

## 2. Redis — Upstash

1. Create a Redis database at [upstash.com](https://upstash.com), same region as Neon.
2. Copy the **TLS** connection URL: `rediss://default:<password>@<host>:6379`
   (note `rediss://` — TLS. `ioredis` handles it with no code change.)

## 3. Hosting — Vercel

1. Import `midat-fx/kezek` at [vercel.com/new](https://vercel.com/new).
2. Set environment variables (Production + Preview):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled connection string |
   | `REDIS_URL` | Upstash `rediss://…` URL |
   | `SESSION_SECRET` | any long random string — `openssl rand -hex 32` |

3. Deploy.

## 4. Migrate and seed

From your machine, pointed at the production database:

```bash
DATABASE_URL='<neon-url>' pnpm db:migrate
DATABASE_URL='<neon-url>' pnpm db:seed
```

Then open `https://<your-app>.vercel.app/aruzhan` to book, and `/admin` to manage
(`owner@kezek.dev` / `kezek-demo`).

## Notes

- **Change the demo password** before sharing the URL publicly — the seed ships a known one.
- SSE works on Vercel's Node runtime; each connection holds a function invocation open, which the free tier tolerates at demo traffic. At real scale, move the stream to a dedicated long-running host or swap SSE for polling.
- The seed is destructive (it truncates and re-inserts). Run it once, on a fresh database.
