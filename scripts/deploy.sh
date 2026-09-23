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

rsync_flags=(-az)

# macOS ships openrsync, which advertises --chmod but rejects the D/F spec that
# GNU rsync 3.x accepts. Probe rather than assume, so the same script works on
# the dev laptop and on the CI runner.
if rsync --chmod=D755,F644 --version >/dev/null 2>&1; then
  # shellcheck disable=SC2054  # the commas are rsync's own --chmod syntax, one element
  rsync_flags+=(--chmod=D755,F644)
else
  echo "note: this rsync does not support --chmod=D755,F644; local file modes are preserved instead" >&2
fi
if [[ "${DEPLOY_DRY_RUN:-}" == "1" ]]; then
  rsync_flags+=(--dry-run --itemize-changes)
  echo "==> DRY RUN: nothing will be written"
fi

# The target is live, so the sync runs in two passes. A client must never see an
# entry point that references assets which are not there yet, nor lose the
# assets of the entry point it already has.
#   1. Everything except the entry points, deleting nothing. The new hashed
#      assets land next to the old ones; the old index.html and sw.js still
#      serve the old build, whose files are all still present.
#   2. Everything, with --delay-updates so the entry points are renamed into
#      place together at the end, and --delete-after so the previous build's
#      assets are pruned only once the new entry points are live.
# rrsync (the CI key's forced command) allows both flags. The trailing slash on
# the source is load-bearing: without it rsync would nest dist/ inside the target.
entry_points=(index.html sw.js manifest.webmanifest)
assets_flags=()
for f in "${entry_points[@]}"; do assets_flags+=("--exclude=/$f"); done

echo "==> syncing $dist -> $DEPLOY_HOST:$DEPLOY_PATH (1/2: assets, no deletes)"
rsync "${rsync_flags[@]}" "${assets_flags[@]}" "$dist/" "$DEPLOY_HOST:$DEPLOY_PATH/"

echo "==> syncing $dist -> $DEPLOY_HOST:$DEPLOY_PATH (2/2: entry points, then prune)"
rsync "${rsync_flags[@]}" --delay-updates --delete-after "$dist/" "$DEPLOY_HOST:$DEPLOY_PATH/"

if [[ "${DEPLOY_DRY_RUN:-}" == "1" ]]; then
  echo "==> dry run finished. Nothing was written."
  exit 0
fi

echo "==> done. Shell is live at https://cezar.ciey.studio/m/"
echo "    Installed clients pick up the new build on next launch (F-PWA-5 prompt)."
