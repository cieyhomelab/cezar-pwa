#!/usr/bin/env bash
# Node "state" of the cezar-upgrade workflow (deploy/cezar-upgrade/cezar-upgrade.yaml).
# Takes the run lock, reads host / npm / PWA-pin versions, and decides what the run has to do.
# Writes the facts to ~/cezar-upgrade/run.lock/state.env for the later check nodes, and
# prints them for the agent nodes ({{nodes.state.output}}).
#
# Exit codes (the workflow branches on them):
#   0  work to do, a new issue is needed
#   3  work to do, an open issue already exists (written to run.lock/issue)
#   1  nothing to do (current, or a sync PR is already open) — lock released
#   2  another run holds the lock — lock left untouched
#   *  error — lock released
#
# CEZ_UPGRADE_DRY_RUN=1 reads everything but takes no lock and writes nothing.
set -uo pipefail

dir="$HOME/cezar-upgrade"
lock="$dir/run.lock"
# shellcheck source=/dev/null
source "$dir/env"   # CEZAR_REPO, CEZAR_API, … — written by install.sh
repo="$CEZAR_REPO"
upstream="https://github.com/open-mercato/cezar.git"
api="$CEZAR_API"
run="${CEZ_RUN_ID:-manual-$$}"
dry="${CEZ_UPGRADE_DRY_RUN:-0}"
checkout="${CEZ_WORKTREE:-$PWD}"
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"

die() { echo "stopped: $*"; exit 4; }
# version_lt a b: true when a < b
version_lt() { [[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$1" ]]; }

# --- 0. Lock (two runs started close together each opened an issue and a PR) ---
if [[ "$dry" != 1 ]]; then
  if ! mkdir "$lock" 2>/dev/null; then
    age=$(( $(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || echo 0) ))
    if (( age < 6 * 3600 )); then
      echo "stopped: another upgrade run holds $lock (owner $(cat "$lock/owner" 2>/dev/null || echo '?'), ${age}s old)"
      exit 2
    fi
    echo "note: removing a stale lock (${age}s old, owner $(cat "$lock/owner" 2>/dev/null || echo '?'))"
    { rm -rf "$lock" && mkdir "$lock"; } || { echo "stopped: could not take $lock"; exit 2; }
  fi
  echo "$run" >"$lock/owner"
  # Keep the lock only for the codes the workflow continues on (0 and 3).
  # shellcheck disable=SC2317  # invoked by the trap
  release_unless_continuing() { local rc=$?; if [[ $rc != 0 && $rc != 3 ]]; then rm -rf "$lock"; fi; }
  trap release_unless_continuing EXIT
fi

# --- 1. State (read-only) ---
host=$(curl -fsS --max-time 10 "$api/health" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])') \
  || die "the cockpit health endpoint did not answer"
latest=$(npm view cezar-cli dist-tags.latest 2>/dev/null) || latest=""
[[ -n "$latest" ]] || die "npm view cezar-cli failed"
sha=$(npm view "cezar-cli@$latest" gitHead 2>/dev/null) || sha=""
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "npm has no gitHead for cezar-cli@$latest"
# Upstream does not always tag releases; when the tag exists it must match the npm gitHead.
tag=$(git ls-remote "$upstream" "refs/tags/v$latest" "refs/tags/v$latest^{}" 2>/dev/null \
  | sort -k2 | awk 'END { print $1 }')
if [[ -n "$tag" && "$tag" != "$sha" ]]; then
  die "tag v$latest is $tag but npm gitHead is $sha — check upstream before syncing"
fi
git -C "$checkout" fetch -q origin main || die "git fetch origin main failed in $checkout"
pin_sha=$(git -C "$checkout" show origin/main:packages/cezar-contract/UPSTREAM | tr -d '[:space:]')
pin=$(git -C "$checkout" show origin/main:apps/pwa/src/config/cezar-compat.ts \
  | sed -nE "s/.*TESTED_CEZAR_VERSION *= *'([^']+)'.*/\1/p" | head -1)
[[ -n "$pin" && -n "$pin_sha" ]] || die "could not read the PWA pin from origin/main"

need_host=0; version_lt "$host" "$latest" && need_host=1
need_pr=0;   [[ "$pin" != "$latest" ]] && need_pr=1

echo "host:   $host"
if [[ -n "$tag" ]]; then tagnote="tag v$latest matches"; else tagnote="no tag v$latest upstream"; fi
echo "latest: $latest (npm gitHead $sha, $tagnote)"
echo "pin:    TESTED_CEZAR_VERSION=$pin, UPSTREAM=${pin_sha:0:7}"

if (( !need_host && !need_pr )); then
  echo "nothing to do: Cezar $latest, host and PWA are current"
  exit 1
fi

# --- 2. Existing work ---
pr=$(gh pr list --repo "$repo" --state open --search "Cezar v$latest in:title" \
  --json number,url -q '.[0] | select(.) | "#\(.number) \(.url)"') || die "gh pr list failed"
if [[ -n "$pr" ]]; then
  echo "nothing to do: an open PR already syncs to $latest: $pr"
  exit 1
fi
issue=$(gh issue list --repo "$repo" --state open --search "Cezar $latest in:title" \
  --json number,title -q "[.[] | select(.title | startswith(\"Chore:\"))][0].number // empty") \
  || die "gh issue list failed"

short=${sha:0:7}
if (( need_host && need_pr )); then
  title="Chore: upgrade the host to Cezar $latest and sync the PWA to it ($short)"
elif (( need_pr )); then
  title="Chore: sync the contract to Cezar $latest ($short) — host already runs it"
else
  title="Chore: upgrade the host to Cezar $latest ($short) — the PWA is already pinned to it"
fi

echo "need:   host upgrade=$([[ $need_host == 1 ]] && echo yes || echo no), PWA sync PR=$([[ $need_pr == 1 ]] && echo yes || echo no)"
echo "issue title: $title"
[[ -n "$issue" ]] && echo "open issue to reuse: #$issue"

if [[ "$dry" != 1 ]]; then
  {
    printf 'HOST=%q\nLATEST=%q\nSHA=%q\nPIN=%q\nPIN_SHA=%q\n' "$host" "$latest" "$sha" "$pin" "$pin_sha"
    printf 'NEED_HOST=%q\nNEED_PR=%q\nTITLE=%q\n' "$need_host" "$need_pr" "$title"
  } >"$lock/state.env"
  [[ -n "$issue" ]] && echo "$issue" >"$lock/issue"
fi
[[ -n "$issue" ]] && exit 3
exit 0
