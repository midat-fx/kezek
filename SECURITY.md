# Security

## Threat model

kezek exposes an **unauthenticated public booking API** (`/api/public/[slug]/*`) alongside an authenticated admin panel. The public surface is the interesting one.

### What the public endpoints assume

| Concern | Mitigation |
|---|---|
| Slot squatting / hold flooding | Per-IP fixed-window rate limits on every public route (`catalog` 60/min, `slots` 120/min, `hold` 20/min, `book` 10/min) via Redis `INCR`+`EXPIRE`. Holds also expire on their own TTL. |
| Booking a slot that isn't free | Slot ranges are **never** taken from the client. `hold` recomputes availability server-side and only accepts a `startMs` present in that grid; `book` re-validates the hold token. |
| Double booking under a race | Two independent layers: a Redis `SET NX EX` hold, and a PostgreSQL `EXCLUDE USING gist` constraint on `(staff_id, tstzrange(start_at, end_at)) WHERE status = 'confirmed'`. A race that beats Redis is rejected by the database (`23P01` → HTTP 409). |
| Stealing someone else's hold | Holds carry a 128-bit random token; `book` requires the token to match the hold stored in Redis. |
| Injection | All input is parsed with Zod schemas (UUIDs, ISO dates, phone pattern); all SQL goes through Drizzle's parameterized query builder. No string-concatenated SQL. |
| Cross-tenant data access | Every query is scoped by `business_id` taken from the **session**, never from user input. Admin mutations re-check that the target row belongs to the caller's business. |

### Sessions

Opaque 256-bit tokens in an `httpOnly`, `sameSite=lax` cookie (`secure` in production). No session data lives in the cookie — it is stored server-side in Redis with a sliding 7-day TTL and deleted on logout. Passwords are hashed with bcrypt (cost 10). Login is rate-limited per IP.

Middleware gates `/admin/*` on cookie presence only (edge runtime); the authoritative Redis lookup happens in the admin layout on every request.

### Known limitations (by design, for a demo)

- No CSRF token on server actions — the app relies on `sameSite=lax` cookies. Add a token before running this with real customer data.
- Rate limiting is per-IP fixed-window; a distributed abuser can exceed the intended rate. Swap for a sliding-log or per-account limit if abused.
- `listHolds` scans Redis keys per request. Fine while holds are short-lived and few; move to a per-staff sorted set at scale.
- No PII encryption at rest: client names and phone numbers are stored in plaintext columns.

## Reporting

Open an issue, or email faizov.midat@gmail.com.
