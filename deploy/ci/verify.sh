#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo 'Verification requires Linux'; exit 1; }
cd "$(dirname "$0")/../.."
: "${CI_DATABASE_ADMIN_URL:?Disposable localhost control database required}"
: "${MIGRATION_BASE_REF:?Full base commit SHA required}"
export CI=true
export NODE_ENV=development FRONTEND_URL=http://localhost:5173 PORT=3000
export JWT_ACCESS_SECRET=ci-only-local-ephemeral-jwt-secret-at-least-32-characters
export REDIS_URL=redis://127.0.0.1:56379/0
export ROUTE_PROVIDER=DISABLED PAYMENT_PROVIDER=DISABLED
export EMAIL_DELIVERY_ENABLED=false SWAGGER_ENABLED=false TRUST_PROXY_HOPS=0
export REFRESH_COOKIE_NAME=logistics_refresh REFRESH_COOKIE_SAME_SITE=lax
export PASSWORD_RESET_URL=http://localhost:5173/reset-password
export VITE_API_URL=/api/v1 VITE_SOCKET_URL=/ VITE_API_DOCS_URL='' VITE_LOCATION_MODE=REAL
database_url() { node -e 'const u=new URL(process.env.CI_DATABASE_ADMIN_URL); u.pathname=process.argv[1]; process.stdout.write(u.toString())' "$1"; }
use_database() { export DATABASE_URL="$(database_url "$1")" DIRECT_URL="$(database_url "$1")"; }

# On GitHub this is the install gate. The local CI image can reuse its clean npm ci layer.
if [[ "${I2_INSTALLED_IN_IMAGE:-false}" != true ]]; then npm ci; fi
npm run db:generate
npm run lint
npm run typecheck
npm test
node --test backend/scripts/migration-integrity.test.mjs
node backend/scripts/migration-integrity.mjs
node deploy/ci/databases.mjs

# Integration fixtures require migrated DBs; the independent release replay follows build.
for database in i1_e2e i1_browser i1_smoke; do
  use_database "$database"
  node backend/scripts/migration-integrity.mjs --database --allow-pending
  npm run db:migrate:deploy
  node backend/scripts/migration-integrity.mjs --database
done
use_database i1_e2e
node backend/scripts/audit-e2e.mjs
npm run build

# Real Prisma engine + exact applied checksums + repeat deploy + schema drift in Linux.
use_database i1_replay
export SHADOW_DATABASE_URL="$(database_url i1_shadow)"
node backend/scripts/migration-integrity.mjs --database --allow-pending
npm run db:migrate:deploy
npm run db:migrate:deploy
npm run db:migrate:status
node backend/scripts/migration-integrity.mjs --database
(
  cd backend
  npx --no-install prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
  npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
)
export AUDIT_DATABASE_URL="$(database_url i1_sql_a)" AUDIT_SHADOW_DATABASE_URL="$(database_url i1_sql_b)"
node backend/scripts/audit-migration-replay.mjs
unset SHADOW_DATABASE_URL

use_database i1_browser
export REDIS_URL=redis://127.0.0.1:56379/1 I1_AUDIT=true
npx playwright install --with-deps chromium
npm run test:browser -- --retries=0
unset I1_AUDIT
export AUDIT_DATABASE_URL="$(database_url i1_smoke)" AUDIT_REDIS_URL=redis://127.0.0.1:56379/2
node backend/scripts/audit-production-smoke.mjs
npm audit --offline=false --audit-level=low
npm audit --offline=false --omit=dev --audit-level=low
node backend/scripts/audit-secrets.mjs
git diff --check
echo 'PASS I2 Linux verification gates'
