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
install -m 644 "$repo/deploy/systemd/cezar-push.service" "$unit_dir/cezar-push.service"
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
  if health=$(curl -fsS http://127.0.0.1:4330/m/push/health 2>/dev/null); then
    echo "==> healthy: $health"
    exit 0
  fi
  sleep 1
done
die "cezar-push did not answer on 127.0.0.1:4330 — see: journalctl --user -u cezar-push -n 50"
