#!/usr/bin/env bash
# Last node on every path that holds the lock: prints the run's report and releases
# ~/cezar-upgrade/run.lock — only when this run owns it.
#   unlock.sh ok|failed
set -uo pipefail

dir="$HOME/cezar-upgrade"
lock="$dir/run.lock"
# shellcheck source=/dev/null
source "$dir/env"   # CEZAR_REPO, CEZAR_API, … — written by install.sh
repo="$CEZAR_REPO"
run="${CEZ_RUN_ID:-}"
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"

outcome="${1:-ok}"
if [[ -f "$lock/state.env" ]]; then
  # shellcheck source=/dev/null
  source "$lock/state.env"
  issue=$(tr -d '[:space:]#' <"$lock/issue" 2>/dev/null)
  echo "Cezar $LATEST: host $HOST, PWA pin $PIN"
  [[ -n "$issue" ]] && echo "issue: https://github.com/$repo/issues/$issue"
  pr=$(gh pr list --repo "$repo" --state open --search "Cezar v$LATEST in:title" \
    --json number,url -q '.[0] | select(.) | .url' 2>/dev/null)
  [[ -n "$pr" ]] && echo "PR: $pr (not merged)"
  [[ "$NEED_HOST" == 1 ]] && echo "host upgrade: unit cezar-upgrade-${LATEST//./-}, log ~/cezar-upgrade/upgrade.log"
fi
[[ "$outcome" == ok ]] || echo "outcome: stopped before the end — see the failed node above"

owner=$(cat "$lock/owner" 2>/dev/null)
if [[ -d "$lock" && ( -z "$run" || "$owner" == "$run" ) ]]; then
  rm -rf "$lock" && echo "lock released"
elif [[ -d "$lock" ]]; then
  echo "lock kept: owned by $owner, not this run ($run)"
fi
exit 0
