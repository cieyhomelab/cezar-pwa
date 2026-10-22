#!/usr/bin/env bash
# Upgrades the cockpit on the VPS to cezar-cli@<new>, rolling back to <old> on failure.
# Installed to ~/cezar-upgrade/ by deploy/cezar-upgrade/install.sh; scheduled by the
# "host" node of the cezar-upgrade workflow (schedule-host.sh) as
#
#   systemd-run --user --unit "cezar-upgrade-${new//./-}" --collect \
#     ~/cezar-upgrade/upgrade-cezar.sh <new> <old> <issue-number>
#
# Must run outside the cockpit's cgroup: restarting the cockpit unit ends every task on it,
# including the one that scheduled this. So it first waits for a quiet cockpit (no run active
# for ~4 min, give up after 12 h), backs up ~/.cezar, pins the version in the unit's
# `npx cezar-cli@<v>` ExecStart, restarts and checks /health. The outcome is posted as a
# comment on <issue> in $CEZAR_REPO either way. Log: ~/cezar-upgrade/upgrade.log
set -uo pipefail

new="${1:?new version}"; old="${2:?old version}"; issue="${3:?issue number}"
dir="$HOME/cezar-upgrade"
# shellcheck source=/dev/null
source "$dir/env"   # CEZAR_REPO, CEZAR_API, CEZAR_UNIT, PUBLIC_ORIGIN — written by install.sh
repo="$CEZAR_REPO"
api="$CEZAR_API"
public="$PUBLIC_ORIGIN"
unit="$CEZAR_UNIT"
unit_file="$HOME/.config/systemd/user/$unit"
export PATH="${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

exec >>"$dir/upgrade.log" 2>&1
log() { echo "$(date -Is) [$new] $*"; }
comment() { gh issue comment "$issue" --repo "$repo" --body "$1" || log "gh comment failed"; }

active_runs() {
  curl -fsS --max-time 10 "$api/workspace/self-update" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["activeRuns"])' 2>/dev/null || echo "?"
}
health_version() {
  curl -fsS --max-time 5 "$api/health" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null
}
set_version() {
  sed -i -E "s#^(ExecStart=.*npx --yes cezar-cli)(@[^ ]+)? #\1@$1 #" "$unit_file"
  systemctl --user daemon-reload
}
wait_for() {
  local v="$1"
  for _ in $(seq 1 36); do
    [[ "$(health_version)" == "$v" ]] && return 0
    sleep 5
  done
  return 1
}

log "start: $old -> $new, issue #$issue"

# 1. Wait for ~4 min of quiet (8 checks x 30 s with no active run), at most 12 h.
quiet=0; deadline=$(( $(date +%s) + 12*3600 ))
while (( quiet < 8 )); do
  if (( $(date +%s) > deadline )); then
    log "gave up: cockpit busy for 12 h"
    comment "🤖 Host upgrade to **$new** gave up: the cockpit had a task running for 12 hours. Nothing was changed; the host still runs $old. Re-run \`~/cezar-upgrade/upgrade-cezar.sh $new $old $issue\` through \`systemd-run --user\`."
    exit 1
  fi
  n="$(active_runs)"
  if [[ "$n" == "0" ]]; then quiet=$((quiet + 1)); else quiet=0; fi
  sleep 30
done
log "cockpit quiet"

# 2. Back up the state and fetch the new package before touching the service.
backup="$dir/backup-$(date +%Y%m%d-%H%M%S)-$old.tgz"
tar -C "$HOME" -czf "$backup" .cezar && chmod 600 "$backup" && log "backup: $backup"
find "$dir" -maxdepth 1 -type f -name 'backup-*.tgz' -printf '%T@ %p\n' \
  | sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r -d '\n' rm -f   # keep the last 5
cp "$unit_file" "$dir/cezar.service.before-$new"

if ! (cd /tmp && timeout 600 npx --yes "cezar-cli@$new" --help >/dev/null); then
  log "npx could not fetch cezar-cli@$new"
  comment "🤖 Host upgrade to **$new** failed before the restart: \`npx cezar-cli@$new\` could not be fetched. Nothing was changed; the host still runs $old. Log: \`~/cezar-upgrade/upgrade.log\`."
  exit 1
fi

# 3. Switch, restart, verify; roll back if the new version does not answer within 3 min.
set_version "$new"
systemctl --user restart "$unit"
if ! wait_for "$new"; then
  log "health did not report $new, rolling back to $old"
  set_version "$old"
  systemctl --user restart "$unit"
  if wait_for "$old"; then state="rolled back, the host runs **$old** again"; else state="**rollback did not come up either — check \`systemctl --user status $unit\`**"; fi
  comment "🤖 Host upgrade to **$new** failed: \`GET /api/v1/health\` did not report $new within 3 minutes; $state. Backup of \`~/.cezar\`: \`$backup\`. Log: \`~/cezar-upgrade/upgrade.log\`."
  exit 1
fi
log "health reports $new"

# 4. Smoke checks after the restart.
m=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$public/m/")
gate=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$public/")
push=$(systemctl --user is-active cezar-push.service)
log "smoke: /m/=$m gate=$gate cezar-push=$push"
note=""
[[ "$m" == 200 && "$gate" == 403 && "$push" == active ]] || note=$'\n\n⚠️ A smoke check is off — look at it before relying on the phone.'
comment "🤖 Host upgraded: \`GET /api/v1/health\` reports **$new** (was $old). After the restart: \`/m/\` answers $m, the cookie gate answers $gate to an anonymous request (403 expected), \`cezar-push\` is $push.$note"
log "done"
