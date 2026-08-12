#!/usr/bin/env bash
#
# One-command production deploy: Vercel (hosting) + Neon (Postgres) + Upstash (Redis).
#
#   ./scripts/deploy.sh
#
# The only interactive step is the Vercel login, which opens a browser once.
# Both databases are provisioned through the Vercel Marketplace, so their
# connection strings are injected straight into the project's environment —
# no credential is ever copied by hand.
#
# Re-running is safe except for step 5: the seed truncates and re-inserts the
# demo data. See DEPLOY.md for the click-through equivalent.
set -euo pipefail
cd "$(dirname "$0")/.."

vc() { npx --yes vercel@latest "$@"; }

echo "==> 1/6  Vercel account"
vc whoami >/dev/null 2>&1 || vc login

echo "==> 2/6  Link this directory to a Vercel project"
vc link --yes

echo "==> 3/6  Provision Postgres (Neon) and Redis (Upstash)"
# Each `integration add` connects the resource to this project and pulls the
# connection string into its environment variables automatically.
vc env ls production 2>/dev/null | grep -q DATABASE_URL || vc integration add neon
vc env ls production 2>/dev/null | grep -q REDIS_URL   || vc integration add upstash

echo "==> 4/6  Session signing key"
if vc env ls production 2>/dev/null | grep -q SESSION_SECRET; then
  echo "    SESSION_SECRET already set, keeping it"
else
  openssl rand -hex 32 | vc env add SESSION_SECRET production
fi

echo "==> 5/6  Deploy, then migrate and seed the fresh database"
url=$(vc deploy --prod --yes | tail -1)

vc env pull .env.production.local --environment=production --yes
set -a; . ./.env.production.local; set +a   # gitignored by .env*
pnpm db:migrate
pnpm db:seed

echo "==> 6/6  Point the repository at the live app"
gh repo edit midat-fx/kezek --homepage "$url" || true

echo
echo "Live:   $url"
echo "Admin:  $url/admin  —  owner@kezek.dev / kezek-demo"
echo "Public: $url/aruzhan"
