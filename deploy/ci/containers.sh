#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Validate every supplied source before build/tag selection; CI never accepts unknown.
release_sha="$(node --experimental-strip-types deploy/ci/resolve-release-source.mjs)"
export RELEASE_SHA="$release_sha"
export RELEASE_TAG="${release_sha:-local}"
export RELEASE_BUILD_TIMESTAMP="${RELEASE_BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%S.000Z)}"
export I2_CONTAINER_JWT="$(openssl rand -hex 48)"
export COMPOSE_PROJECT_NAME="i2-release-${GITHUB_RUN_ID:-local}"
compose() { docker compose -f deploy/ci/compose.yml "$@"; }
mkdir -p test-results/i2/tls
# Only disposable CI certificate material; never disable certificate verification.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost,IP:127.0.0.1 \
  -keyout test-results/i2/tls/key.pem -out test-results/i2/tls/cert.pem 2>/dev/null
cleanup() {
  status=$?
  trap - EXIT
  if [[ $status != 0 ]]; then compose logs --no-color > test-results/i2/container-failure.log; fi
  compose down --volumes --remove-orphans
  # Private key is test-only but must not enter uploaded diagnostics.
  rm -f test-results/i2/tls/key.pem
  exit "$status"
}
trap cleanup EXIT
for target in backend frontend migration; do
  docker build --target "$target" \
    --build-arg RELEASE_SHA="$RELEASE_SHA" \
    --build-arg GITHUB_SHA="${GITHUB_SHA:-}" \
    --build-arg RENDER_GIT_COMMIT="${RENDER_GIT_COMMIT:-}" \
    --build-arg RELEASE_BUILD_TIMESTAMP="$RELEASE_BUILD_TIMESTAMP" \
    -t "logistics-i2-$target:$RELEASE_TAG" .
done
docker run --rm --entrypoint sh "logistics-i2-backend:$RELEASE_TAG" -c \
  'test ! -e /app/.env && test ! -d /app/node_modules/prisma && test ! -d /app/backend/prisma && test -f /app/backend/dist/main.js && test "$(id -u)" -ne 0'
compose up -d --wait postgres redis
compose run --rm migrate
compose up -d --wait backend frontend ingress
NODE_EXTRA_CA_CERTS="$PWD/test-results/i2/tls/cert.pem" node --experimental-strip-types deploy/ci/proxy-smoke.mjs
container=$(compose ps -q backend)
compose stop -t 45 backend
code=$(docker inspect --format '{{.State.ExitCode}}' "$container")
# Nest re-sends the handled SIGTERM after shutdown hooks complete (143); 137 is forced kill.
[[ "$code" == 0 || "$code" == 143 ]] || { echo "Backend did not drain: exit $code"; exit 1; }
compose up -d --wait backend
NODE_EXTRA_CA_CERTS="$PWD/test-results/i2/tls/cert.pem" node --experimental-strip-types deploy/ci/proxy-smoke.mjs
echo 'PASS production containers: migrate, start, HTTPS/API/socket, SIGTERM and restart'
