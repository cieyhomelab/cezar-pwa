#!/usr/bin/env bash
# Installs or upgrades cezar-push as a systemd USER service. RUN THIS ON THE VPS,
# as the user Cezar runs as — not root:
#
#   deploy/push/install.sh
#
# Builds the one-file bundle, copies it to ~/cezar-push, creates the VAPID key
# pair once (never rotated — every device is bound to it), installs the unit and
# (re)starts it. Re-running upgrades the bundle and keeps keys and subscriptions.
#
# CEZAR_PUSH_HOME and STATE_DIR move the bundle and the state elsewhere. The
# unit is rendered with the paths this script actually wrote to, and the health
# probe takes PORT from the unit and the env file it reads, so the installed
# service and the probe cannot point somewhere the install never touched.
# deploy/push/rehearse.sh exercises that against a scratch $HOME.
#
# The nginx half is deploy/nginx/install.sh: it routes /m/push/ here behind the
# gate. Order does not matter; until both are in, the app says the notification
# server is not answering.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

[[ "$(id -u)" != 0 ]] || die "run as the user Cezar runs as, not root — this is a user unit"
command -v node >/dev/null || die "node not found on PATH"
command -v systemctl >/dev/null || die "systemctl not found"

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
home_dir="${CEZAR_PUSH_HOME:-$HOME/cezar-push}"
state_dir="${STATE_DIR:-$HOME/.cezar-push}"
unit_dir="$HOME/.config/systemd/user"

# systemd takes only absolute paths in WorkingDirectory and ExecStart, so a
# relative override is one this script cannot honour — say so here rather than
# leave the unit to be refused after everything else has been installed.
for dir in "$home_dir" "$state_dir"; do
  [[ "$dir" == /* ]] || die "CEZAR_PUSH_HOME and STATE_DIR must be absolute paths; got: $dir"
done

echo "==> building the bundle"
(cd "$repo" && npm run build -w @cezar-pwa/shared >/dev/null && npm run build -w @cezar-pwa/push-sidecar >/dev/null)
bundle="$repo/apps/push-sidecar/dist/cezar-push.mjs"
[[ -f "$bundle" ]] || die "build produced no bundle at $bundle"

install -d -m 700 "$home_dir" "$state_dir"
install -m 644 "$bundle" "$home_dir/cezar-push.mjs"
echo "==> installed $home_dir/cezar-push.mjs"

# Prints only the PUBLIC key. Keeps an existing pair.
STATE_DIR="$state_dir" node "$home_dir/cezar-push.mjs" init

install -d "$unit_dir"

# The unit spells its paths %h-relative so it can also be copied by hand, which
# only holds for the defaults: with CEZAR_PUSH_HOME or STATE_DIR set it has to
# point where this script installed the bundle and the keys, or the service
# crash-loops on a missing bundle or "no VAPID keys". Rendered through bash
# substitution, not sed: the replacement is literal whatever the paths contain.
unit="$(<"$repo/deploy/systemd/cezar-push.service")"
unit="${unit//%h\/cezar-push/$home_dir}"
unit="${unit//%h\/.cezar-push/$state_dir}"
for expected in \
  "WorkingDirectory=$home_dir" \
  "ExecStart=/usr/bin/node $home_dir/cezar-push.mjs" \
  "Environment=STATE_DIR=$state_dir" \
  "EnvironmentFile=-$state_dir/env"
do
  [[ "$unit" == *"$expected"* ]] ||
    die "rendering the unit produced no '$expected' — deploy/systemd/cezar-push.service changed shape, so this script must be updated to match"
done

# The port the service will listen on: the unit's own default, overridden by the
# env file it reads through EnvironmentFile. A user unit inherits nothing from
# this shell, so a PORT exported here would not reach it — and must not be read.
port="$(sed -n 's/^Environment=PORT=\([0-9]\{1,5\}\)$/\1/p' <<<"$unit" | tail -n1)"
[[ -n "$port" ]] || die "no 'Environment=PORT=<number>' in deploy/systemd/cezar-push.service — cannot tell where to probe"
if [[ -f "$state_dir/env" ]]; then
  # systemd: last assignment wins, and the value may be quoted.
  from_env="$(sed -n 's/^[[:space:]]*PORT=["'\'']\?\([^"'\''[:space:]]*\)["'\'']\?[[:space:]]*$/\1/p' "$state_dir/env" | tail -n1)"
  if [[ -n "$from_env" ]]; then
    if ! [[ "$from_env" =~ ^[0-9]{1,5}$ ]] || ((from_env < 1 || from_env > 65535)); then
      die "PORT in $state_dir/env is not a port: $from_env — cezar-push would refuse to start"
    fi
    port="$from_env"
  fi
fi

printf '%s\n' "$unit" >"$unit_dir/cezar-push.service"
chmod 644 "$unit_dir/cezar-push.service"
echo "==> installed $unit_dir/cezar-push.service (state $state_dir, port $port)"

systemctl --user daemon-reload
systemctl --user enable cezar-push >/dev/null
systemctl --user restart cezar-push
echo "==> cezar-push (re)started"

if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
  echo "warning: lingering is off, so cezar-push stops when you log out." >&2
  echo "         Run: sudo loginctl enable-linger $USER" >&2
fi

# The health answer carries counts and states only.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if health=$(curl -fsS "http://127.0.0.1:$port/m/push/health" 2>/dev/null); then
    echo "==> healthy: $health"
    exit 0
  fi
  sleep 1
done
die "cezar-push did not answer on 127.0.0.1:$port — see: journalctl --user -u cezar-push -n 50"
