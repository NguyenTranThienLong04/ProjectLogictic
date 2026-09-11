#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo 'Migration jobs require Linux'; exit 1; }
: "${DIRECT_URL:?Inject migration-role DIRECT_URL}"
cd /app
node backend/scripts/migration-integrity.mjs --database --allow-pending
cd backend
npx --no-install prisma migrate deploy
npx --no-install prisma migrate status
cd /app
node backend/scripts/migration-integrity.mjs --database
