#!/usr/bin/env bash
# Node "host" of the cezar-upgrade workflow. Runs after the issue exists.
# When the host is behind, schedules upgrade-cezar.sh as a transient user unit (outside the
# cockpit's cgroup — restarting cezar here would kill this run) and says so on the issue.
# Never restarts cezar itself.
#
# Prints ISSUE=<n> for the PR node. Exit codes:
#   0   done, a PWA sync PR is still needed
#   10  done, no PR needed (host-only upgrade)
#   *   error
set -uo pipefail

dir="$HOME/cezar-upgrade"
lock="$dir/run.lock"
# shellcheck source=/dev/null
source "$dir/env"   # CEZAR_REPO, CEZAR_API, … — written by install.sh
repo="$CEZAR_REPO"
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

[[ -f "$lock/state.env" ]] || { echo "stopped: $lock/state.env is missing"; exit 4; }
# shellcheck source=/dev/null
source "$lock/state.env"
issue=$(tr -d '[:space:]#' <"$lock/issue" 2>/dev/null)
[[ "$issue" =~ ^[0-9]+$ ]] || { echo "stopped: $lock/issue does not hold an issue number"; exit 4; }
state=$(gh issue view "$issue" --repo "$repo" --json state -q .state) \
  || { echo "stopped: gh cannot read issue #$issue"; exit 4; }
[[ "$state" == OPEN ]] || { echo "stopped: issue #$issue is $state"; exit 4; }

echo "ISSUE=$issue"
if [[ "$NEED_HOST" == 1 ]]; then
  unit="cezar-upgrade-${LATEST//./-}"
  if systemctl --user is-active --quiet "$unit" || systemctl --user is-activating --quiet "$unit" 2>/dev/null; then
    echo "HOST_UPGRADE=already scheduled ($unit is running)"
  else
    systemd-run --user --unit "$unit" --collect "$dir/upgrade-cezar.sh" "$LATEST" "$HOST" "$issue" \
      || { echo "stopped: systemd-run $unit failed"; exit 4; }
    gh issue comment "$issue" --repo "$repo" --body "🤖 Host upgrade to **$LATEST** is scheduled, not done yet. The transient unit \`$unit\` waits for a quiet cockpit (~4 min with no task, gives up after 12 h), backs up \`~/.cezar\`, pins \`cezar-cli@$LATEST\` in \`cezar.service\`, restarts, checks health and rolls back to $HOST if it does not answer within 3 minutes, then posts the outcome here. Cancel: \`systemctl --user stop $unit\`. Log: \`~/cezar-upgrade/upgrade.log\`." \
      >/dev/null || echo "note: gh issue comment failed"
    echo "HOST_UPGRADE=scheduled ($unit, $HOST -> $LATEST)"
  fi
else
  echo "HOST_UPGRADE=not needed (host runs $HOST)"
fi

if [[ "$NEED_PR" == 1 ]]; then
  echo "PR_NEEDED=yes"
  exit 0
fi
echo "PR_NEEDED=no (the PWA is already pinned to $LATEST)"
exit 10
