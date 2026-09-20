#!/usr/bin/env bash
# Builds the PWA and ships apps/pwa/dist to the VPS.
#
# Requires DEPLOY_HOST in .env.local (gitignored), e.g.
#   DEPLOY_HOST=user@cezar.ciey.studio
#   DEPLOY_PATH=/var/www/cezar-mobile     # optional, this is the default
#
# The sidecar is deployed separately — it is a long-running service, not static
# files (see deploy/systemd/cezar-push.service).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a && source .env.local && set +a
fi

: "${DEPLOY_HOST:?DEPLOY_HOST is not set — add it to .env.local (user@host)}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/cezar-mobile}"

echo "==> building"
npm run build -w @cezar-pwa/pwa

dist="$repo_root/apps/pwa/dist"
[[ -f "$dist/index.html" ]] || { echo "build produced no index.html at $dist" >&2; exit 1; }

echo "==> syncing $dist -> $DEPLOY_HOST:$DEPLOY_PATH"
# --delete prunes the previous build's hashed assets. The trailing slash on the
# source is load-bearing: without it rsync would nest dist/ inside the target.
rsync -az --delete \
  --chmod=D755,F644 \
  "$dist/" "$DEPLOY_HOST:$DEPLOY_PATH/"

echo "==> done. Shell is live at https://cezar.ciey.studio/m/"
echo "    Installed clients pick up the new build on next launch (F-PWA-5 prompt)."
