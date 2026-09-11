#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${GHCR_TOKEN:?GHCR token required}"
: "${GITHUB_ACTOR:?GitHub actor required}"
: "${GITHUB_REPOSITORY:?GitHub repository required}"
: "${GITHUB_SHA:?Release SHA required}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || exit 1
registry="ghcr.io/${GITHUB_REPOSITORY,,}"
mkdir -p test-results/i3
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
trap 'docker logout ghcr.io >/dev/null' EXIT
export IMAGE_MANIFEST_PATH=test-results/i3/images.json
node -e 'require("node:fs").writeFileSync(process.env.IMAGE_MANIFEST_PATH, JSON.stringify({sourceSha:process.env.GITHUB_SHA,runUrl:`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,images:{}},null,2)+"\n")'
for target in backend frontend migration; do
  # containers.sh built and tested these exact local artifacts. Never rebuild at publication.
  local_image="logistics-i2-$target:$GITHUB_SHA"
  image="$registry/$target:$GITHUB_SHA"
  docker image inspect "$local_image" >/dev/null
  docker tag "$local_image" "$image"
  docker push "$image"
  export IMAGE_TARGET="$target"
  export IMAGE_REFERENCE
  IMAGE_REFERENCE=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | awk -v prefix="$registry/$target@sha256:" 'index($0,prefix)==1 {print; exit}')
  [[ "$IMAGE_REFERENCE" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Missing immutable registry digest'; exit 1; }
  # Verify that the immutable registry manifest is readable before recording promotion input.
  docker manifest inspect "$IMAGE_REFERENCE" >/dev/null
  node -e 'const fs=require("node:fs");const p=process.env.IMAGE_MANIFEST_PATH;const m=JSON.parse(fs.readFileSync(p));m.images[process.env.IMAGE_TARGET]=process.env.IMAGE_REFERENCE;fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n")'
done
echo 'Published tested images; immutable digests recorded in staging-images artifact.'
