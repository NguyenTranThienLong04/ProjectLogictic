#!/usr/bin/env bash
set -euo pipefail
# Local evidence for an uncommitted workspace snapshot. Runs ONLY in the disposable CI image.
[[ -f /.dockerenv && "$PWD" == /app && ! -e /app/.git ]] || {
  echo 'Requires an isolated CI image at /app without a mounted Git directory'; exit 1;
}
git init -q
git add .
git -c user.name='I2 Local Verification' -c user.email='i2@example.test' commit -qm 'Disposable I2 verification snapshot'
export MIGRATION_BASE_REF="$(git rev-parse HEAD)"
git clone -q --no-local /app /clean-checkout
cd /clean-checkout
unset I2_INSTALLED_IN_IMAGE
bash deploy/ci/verify.sh
