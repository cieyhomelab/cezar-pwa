#!/usr/bin/env bash
# Vendors Cezar's contract into packages/cezar-contract/, pinned to one commit.
#
#   npm run sync:contract <sha>
#
# Why vendoring at all: @open-mercato/cezar-contract and cezar-api-client are on
# npm only as prereleases older than the server we run, so the published
# packages do not describe the live API (CLAUDE.md rule 3).
#
# Pick the sha that matches the instance: GET /api/v1/health -> version, then the
# commit tagged for it in the Cezar repo.
set -euo pipefail

sha="${1:-}"
if [[ -z "$sha" ]]; then
  echo "usage: npm run sync:contract <sha>" >&2
  exit 64
fi

repo="${CEZAR_REPO:-https://github.com/open-mercato/cezar.git}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$repo_root/packages/cezar-contract"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "==> fetching $repo @ $sha"
git init --quiet "$tmp"
git -C "$tmp" remote add origin "$repo"
# Blobless partial clone of one commit: the whole history is never downloaded.
git -C "$tmp" fetch --quiet --depth 1 --filter=blob:none origin "$sha"
git -C "$tmp" checkout --quiet FETCH_HEAD

src_contract="$tmp/packages/contract/src"
src_events="$tmp/packages/api-client/src/protocol/ui-events.ts"
[[ -d "$src_contract" ]] || { echo "missing packages/contract/src at $sha" >&2; exit 1; }
[[ -f "$src_events" ]]   || { echo "missing packages/api-client/src/protocol/ui-events.ts at $sha" >&2; exit 1; }

echo "==> vendoring into packages/cezar-contract/src"
rm -rf "$dest/src"
mkdir -p "$dest/src/contract" "$dest/src/protocol"
cp -R "$src_contract/." "$dest/src/contract/"
cp "$src_events" "$dest/src/protocol/ui-events.ts"

printf '%s\n' "$sha" > "$dest/UPSTREAM"

echo "==> pinned to $sha"
echo "    Next: bump TESTED_CEZAR_VERSION in apps/pwa/src/config/cezar-compat.ts,"
echo "    then run the contract tests (npm test)."
