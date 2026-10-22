#!/usr/bin/env bash
# Installs or updates the daily Cezar upgrade automation. RUN THIS ON THE VPS, as the
# user Cezar runs as — not root:
#
#   deploy/cezar-upgrade/install.sh
#
# What it puts where:
#   ~/cezar-upgrade/{state,schedule-host,unlock,upgrade-cezar}.sh   the workflow's scripts
#   ~/cezar-upgrade/env                                              host settings (below), mode 600
#   <project root>/.ai/cezar/workflows/cezar-upgrade.yaml            the workflow (gitignored there)
#   the cockpit automation named in automation.json — created enabled, or updated in place
#
# Host settings, each an env var on the first run; later runs read them back from
# ~/cezar-upgrade/env, so a bare re-run only refreshes the files and the automation:
#   CEZAR_PROJECT_ID  the cockpit project of this repo                   (default cezar-pwa)
#   CEZAR_PORT        the cockpit's local port                           (default 4321)
#   CEZAR_UNIT        the cockpit's systemd user unit                     (default cezar.service)
#   CEZAR_REPO        owner/name on GitHub              (default: this checkout's origin)
#   PUBLIC_ORIGIN     https://<your-host>, for the post-upgrade smoke checks
#                     (default: PUBLIC_ORIGIN from ~/.cezar-push/env)
#
# The workflow upgrades the host by scheduling upgrade-cezar.sh as a transient user unit,
# so linger must be on (it already is for the cockpit) and `gh` must be logged in as a
# user that can open issues and PRs here. Rehearsal without a cockpit: deploy/cezar-upgrade/rehearse.sh.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

[[ "$(id -u)" != 0 ]] || die "run as the user Cezar runs as, not root"
for c in curl gh git npx python3 systemctl systemd-run; do
  command -v "$c" >/dev/null || die "$c not found on PATH"
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$here/../.." && pwd)"
dir="$HOME/cezar-upgrade"
env_file="$dir/env"

[[ ! -d "$dir/run.lock" ]] || die "an upgrade run holds $dir/run.lock — wait for it, or remove the lock if it is stale"

# --- settings: env var > ~/cezar-upgrade/env > default ---
saved() { [[ -f "$env_file" ]] || return 0; sed -nE "s/^$1=(.*)$/\1/p" "$env_file" | tail -1 | tr -d "'\""; }
origin_repo() {
  git -C "$repo_dir" remote get-url origin 2>/dev/null \
    | sed -nE 's#^(https://github\.com/|git@github\.com:)([^/]+/[^/.]+)(\.git)?$#\2#p' || true
}
push_origin() { [[ -f "$HOME/.cezar-push/env" ]] || return 0; sed -nE 's/^PUBLIC_ORIGIN=(.*)$/\1/p' "$HOME/.cezar-push/env" | tail -1 | tr -d "'\""; }

project="${CEZAR_PROJECT_ID:-$(saved CEZAR_PROJECT_ID)}"; project="${project:-cezar-pwa}"
port="${CEZAR_PORT:-$(saved CEZAR_PORT)}";                port="${port:-4321}"
unit="${CEZAR_UNIT:-$(saved CEZAR_UNIT)}";                unit="${unit:-cezar.service}"
gh_repo="${CEZAR_REPO:-$(saved CEZAR_REPO)}";             gh_repo="${gh_repo:-$(origin_repo)}"
public="${PUBLIC_ORIGIN:-$(saved PUBLIC_ORIGIN)}";        public="${public:-$(push_origin)}"

[[ "$project" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "CEZAR_PROJECT_ID looks wrong: $project"
[[ "$port" =~ ^[0-9]+$ ]] || die "CEZAR_PORT must be a number, got: $port"
[[ "$unit" =~ ^[A-Za-z0-9@._-]+\.service$ ]] || die "CEZAR_UNIT must be a unit name, got: $unit"
[[ "$gh_repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "set CEZAR_REPO=<owner>/<name> (origin is not a GitHub URL)"
[[ "$public" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "set PUBLIC_ORIGIN=https://<your-host>"

api_url="http://127.0.0.1:$port"
health=$(curl -fsS --max-time 10 "$api_url/api/v1/health") || die "no cockpit answers on $api_url"
host_version=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' <<<"$health")
systemctl --user cat "$unit" >/dev/null 2>&1 || die "systemd user unit $unit not found"

# The project's checkout, from the cockpit's own config.
project_root=$(python3 - "$HOME/.cezar/config.json" "$project" <<'EOF'
import json, sys
config, project = sys.argv[1], sys.argv[2]
for p in json.load(open(config)).get("projects", []):
    if p.get("id") == project:
        print(p["root"])
EOF
) || true
[[ -n "$project_root" && -d "$project_root" ]] || die "cockpit project $project not found in ~/.cezar/config.json"

# --- files ---
install -d -m 700 "$dir"
for f in state.sh schedule-host.sh unlock.sh upgrade-cezar.sh; do
  install -m 700 "$here/$f" "$dir/$f"
done
umask 077
cat >"$env_file.tmp" <<EOF
# Written by deploy/cezar-upgrade/install.sh — re-run it to change these.
CEZAR_PROJECT_ID=$project
CEZAR_PORT=$port
CEZAR_API=$api_url/api/v1
CEZAR_UNIT=$unit
CEZAR_REPO=$gh_repo
PUBLIC_ORIGIN=$public
EOF
mv "$env_file.tmp" "$env_file"
install -d "$project_root/.ai/cezar/workflows"
install -m 644 "$here/cezar-upgrade.yaml" "$project_root/.ai/cezar/workflows/cezar-upgrade.yaml"
echo "scripts → $dir, workflow → $project_root/.ai/cezar/workflows/cezar-upgrade.yaml"

# --- automation: the same CLI version as the host ---
cez() { CEZ_API_URL="$api_url" CEZ_PROJECT_ID="$project" npx --yes "cezar-cli@$host_version" automation "$@"; }
name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$here/automation.json")
id=""
while IFS= read -r line; do
  [[ "$line" == *"  $name" ]] && id="${line%% *}"
done < <(cez list)
if [[ -n "$id" ]]; then
  cez update "$id" --file "$here/automation.json" >/dev/null
  echo "automation updated: $id ($name)"
else
  cez create --file "$here/automation.json" --enable >/dev/null
  echo "automation created and enabled: $name"
fi
cez list | grep -F "  $name"

# --- dry run of the first node: no lock, nothing written ---
echo "dry run of state.sh:"
(cd "$project_root" && CEZ_UPGRADE_DRY_RUN=1 CEZ_WORKTREE="$project_root" "$dir/state.sh") || true
