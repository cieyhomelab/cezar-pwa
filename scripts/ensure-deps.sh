#!/usr/bin/env bash
# SessionStart hook: make a fresh clone workable before anyone asks.
#
# node_modules is not in git, so a clone on a new machine starts with nothing
# installed. This installs it once, and reports the things that are too
# expensive to fetch automatically.
#
# Always exits 0 — a bootstrap problem should surface as a message, never as a
# blocked session.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 0
cd "$repo_root" || exit 0

log=/tmp/cezar-pwa-bootstrap.log
notes=""
add() { notes="${notes:+$notes; }$1"; }

if [[ ! -d node_modules ]]; then
  if npm install --no-audit --no-fund >"$log" 2>&1; then
    add "node_modules was missing, ran npm install"
  else
    add "node_modules is missing and npm install FAILED (see $log)"
  fi
fi

# WebKit is a ~78 MB download and CLAUDE.md says not to fetch browsers
# unprompted, so this only reports it.
if [[ -d node_modules/@playwright ]]; then
  cache="${PLAYWRIGHT_BROWSERS_PATH:-}"
  if [[ -z "$cache" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      cache="$HOME/Library/Caches/ms-playwright"
    else
      cache="$HOME/.cache/ms-playwright"
    fi
  fi
  if ! ls -d "$cache"/webkit-* >/dev/null 2>&1; then
    add "WebKit is not installed, so npm run test:e2e cannot run until 'npx playwright install webkit'"
  fi
fi

# Nothing to say: stay silent so a normal session start costs nothing.
[[ -z "$notes" ]] && exit 0

# Keep the payload JSON-safe; these messages are plain prose by construction.
notes="${notes//\\/}"
notes="${notes//\"/}"

printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Repo bootstrap: %s"}}\n' \
  "$notes" "$notes"
