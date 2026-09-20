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

# DEPLOY_DRY_RUN=1 walks the whole path -- build, connect, diff -- and writes
# nothing. Use it to validate credentials on a target you cannot test twice.

echo "==> building"
npm run build -w @cezar-pwa/pwa

dist="$repo_root/apps/pwa/dist"
[[ -f "$dist/index.html" ]] || { echo "build produced no index.html at $dist" >&2; exit 1; }

rsync_flags=(-az --delete)

# macOS ships openrsync, which advertises --chmod but rejects the D/F spec that
# GNU rsync 3.x accepts. Probe rather than assume, so the same script works on
# the dev laptop and on the CI runner.
if rsync --chmod=D755,F644 --version >/dev/null 2>&1; then
  rsync_flags+=(--chmod=D755,F644)
else
  echo "note: this rsync does not support --chmod=D755,F644; local file modes are preserved instead" >&2
fi
if [[ "${DEPLOY_DRY_RUN:-}" == "1" ]]; then
  rsync_flags+=(--dry-run --itemize-changes)
  echo "==> DRY RUN: nothing will be written"
fi

echo "==> syncing $dist -> $DEPLOY_HOST:$DEPLOY_PATH"
# --delete prunes the previous build's hashed assets. The trailing slash on the
# source is load-bearing: without it rsync would nest dist/ inside the target.
rsync "${rsync_flags[@]}" "$dist/" "$DEPLOY_HOST:$DEPLOY_PATH/"

if [[ "${DEPLOY_DRY_RUN:-}" == "1" ]]; then
  echo "==> dry run finished. Nothing was written."
  exit 0
fi

echo "==> done. Shell is live at https://cezar.ciey.studio/m/"
echo "    Installed clients pick up the new build on next launch (F-PWA-5 prompt)."
