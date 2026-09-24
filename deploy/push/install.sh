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
# PUBLIC_ORIGIN — the https:// origin the app is served from, e.g.
# https://cezar.example.com — is required: the sidecar refuses writes from any
# other origin and will not start without it. Pass it once
# (PUBLIC_ORIGIN=https://<your-host> deploy/push/install.sh); it is kept in
# STATE_DIR/env, so later runs read it from there. On a terminal the installer
# asks for it instead.
#
# CEZAR_PUSH_HOME (~/cezar-push) and STATE_DIR (~/.cezar-push) move the bundle
# and the state. The unit is rendered with whatever they resolve to, so the
# service, the keys written here and the health probe below always agree; the
# file in the repo keeps systemd's %h, so a hand copy still works for the
# defaults. Paths this script cannot put in a unit file are refused, not
# silently ignored.
#
# The nginx half is deploy/nginx/install.sh: it routes /m/push/ here behind the
# gate. Order does not matter; until both are in, the app says the notification
# server is not answering.
#
# Rehearsal in a scratch $HOME, no VPS needed: deploy/push/rehearse.sh.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

[[ "$(id -u)" != 0 ]] || die "run as the user Cezar runs as, not root — this is a user unit"
command -v node >/dev/null || die "node not found on PATH"
command -v systemctl >/dev/null || die "systemctl not found"

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The rendered unit carries these verbatim, so refuse anything that would land
# in it as a systemd specifier (%h and friends), as a quoting problem (a space
# or a quote in ExecStart), or as a path the service resolves against some
# other directory than the one used here.
normalise_dir() {
  local name="$1" value="$2"
  [[ "$value" == /* ]] || die "$name must be an absolute path, got: $value"
  while [[ "$value" == */ ]]; do value="${value%/}"; done
  [[ -n "$value" ]] || die "$name must not be the filesystem root"
  [[ "$value" =~ ^[A-Za-z0-9._/+@-]+$ ]] ||
    die "$name may only contain letters, digits and ._/+@- — got: $2"
  printf '%s' "$value"
}

home_dir=$(normalise_dir CEZAR_PUSH_HOME "${CEZAR_PUSH_HOME:-$HOME/cezar-push}")
state_dir=$(normalise_dir STATE_DIR "${STATE_DIR:-$HOME/.cezar-push}")
unit_dir="$HOME/.config/systemd/user"
env_file="$state_dir/env"

# The last assignment of a variable in a systemd env/unit file, quotes off.
last_value() { # last_value <sed-prefix> <file>
  local prefix="$1" file="$2" value
  [[ -f "$file" ]] || return 0
  value=$(sed -n "s/^${prefix}//p" "$file" | tail -n 1)
  value="${value%$'\r'}"
  value="${value#[\"\']}"
  value="${value%[\"\']}"
  printf '%s' "$value"
}

# PUBLIC_ORIGIN: from the caller, else the env file an earlier run wrote, else
# asked for. Checked here with the sidecar's own rule (config.ts), so a value
# the service would refuse fails the install instead of a restart loop.
stored_origin=$(last_value '[[:space:]]*PUBLIC_ORIGIN=' "$env_file")
public_origin="${PUBLIC_ORIGIN:-$stored_origin}"
if [[ -z "$public_origin" && -t 0 ]]; then
  read -r -p "PUBLIC_ORIGIN (the https:// origin the app is served from, e.g. https://cezar.example.com): " public_origin
fi
[[ -n "$public_origin" ]] ||
  die "PUBLIC_ORIGIN is not set — run: PUBLIC_ORIGIN=https://<your-host> $0"
node -e '
  const v = process.argv[1]
  let u
  try { u = new URL(v) } catch { process.exit(1) }
  process.exit(u.protocol === "https:" && u.origin === v ? 0 : 1)
' "$public_origin" ||
  die "PUBLIC_ORIGIN must be a bare https:// origin (scheme, host, optional port; no trailing slash), got: $public_origin"

echo "==> building the bundle"
(cd "$repo" && npm run build -w @cezar-pwa/shared >/dev/null && npm run build -w @cezar-pwa/push-sidecar >/dev/null)
bundle="$repo/apps/push-sidecar/dist/cezar-push.mjs"
[[ -f "$bundle" ]] || die "build produced no bundle at $bundle"

# `install -d -m 700` is the only thing that enforces 0700 on the state
# directory: the sidecar's own mkdir sets the mode when it creates the
# directory, but leaves an existing looser one alone.
install -d -m 700 "$home_dir" "$state_dir"
install -m 644 "$bundle" "$home_dir/cezar-push.mjs"
echo "==> installed $home_dir/cezar-push.mjs"

# Keep PUBLIC_ORIGIN in the env file, replacing an older value and leaving
# every other line alone. The file stays 0600 (it may hold a mailto: contact).
if [[ "$public_origin" != "$stored_origin" ]]; then
  [[ -f "$env_file" ]] || install -m 600 /dev/null "$env_file"
  kept=$(grep -v '^[[:space:]]*PUBLIC_ORIGIN=' "$env_file" || true)
  { [[ -z "$kept" ]] || printf '%s\n' "$kept"; printf 'PUBLIC_ORIGIN=%s\n' "$public_origin"; } >"$env_file"
  echo "==> PUBLIC_ORIGIN=$public_origin written to $env_file"
fi

# Prints only the PUBLIC key. Keeps an existing pair.
STATE_DIR="$state_dir" PUBLIC_ORIGIN="$public_origin" node "$home_dir/cezar-push.mjs" init

# The unit in the repo spells its paths with systemd's %h, which is right for
# the defaults and wrong for every override: rendered here, WorkingDirectory,
# ExecStart, STATE_DIR and the EnvironmentFile all follow the paths above
# instead of sending the service to look for a bundle and keys that are not
# there.
src_unit="$repo/deploy/systemd/cezar-push.service"
[[ -f "$src_unit" ]] || die "unit not found: $src_unit"
rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT
sed -e "s|%h/\.cezar-push|$state_dir|g" -e "s|%h/cezar-push|$home_dir|g" "$src_unit" >"$rendered"

# Should the unit ever stop spelling a path that way, the substitution above
# would quietly do nothing and the service would be back on the defaults — the
# bug this renders around. Check the result rather than trust the sed.
for expected in \
  "WorkingDirectory=$home_dir" \
  "ExecStart=/usr/bin/node $home_dir/cezar-push.mjs" \
  "Environment=STATE_DIR=$state_dir" \
  "EnvironmentFile=-$state_dir/env"; do
  grep -qF -- "$expected" "$rendered" ||
    die "the rendered unit has no '$expected' — $src_unit no longer spells its paths with %h/cezar-push and %h/.cezar-push"
done
# Comments are substituted along with the directives, which is what we want —
# the ones naming a path read truer once it is the real one. They are skipped
# here only so the header's prose about %h cannot trip the check.
if grep -v '^[[:space:]]*#' "$rendered" | grep -q '%h'; then
  die "the rendered unit still carries %h — $src_unit gained a path this installer does not render"
fi

install -d "$unit_dir"
install -m 644 "$rendered" "$unit_dir/cezar-push.service"
echo "==> installed $unit_dir/cezar-push.service (state in $state_dir)"
systemctl --user daemon-reload
systemctl --user enable cezar-push >/dev/null
systemctl --user restart cezar-push
echo "==> cezar-push (re)started"

if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
  echo "warning: lingering is off, so cezar-push stops when you log out." >&2
  echo "         Run: sudo loginctl enable-linger $USER" >&2
fi

# Which port the service actually listens on: the unit's Environment=PORT=,
# then the state directory's env file, which systemd reads after it and so
# wins. Last assignment wins there too. HOST is deliberately not read — the
# unit pins it to loopback, because nginx is the sole way in (A5/A6).
port=$(last_value 'Environment=PORT=' "$rendered")
override=$(last_value '[[:space:]]*PORT=' "$env_file")
[[ -n "$override" ]] && port="$override"
if ! [[ "$port" =~ ^[0-9]{1,5}$ ]] || ((port < 1 || port > 65535)); then
  die "PORT is not a port: '$port' (from $state_dir/env, or the unit's own default)"
fi

# The health answer carries counts and states only.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if health=$(curl -fsS "http://127.0.0.1:$port/m/push/health" 2>/dev/null); then
    echo "==> healthy on 127.0.0.1:$port: $health"
    exit 0
  fi
  sleep 1
done
die "cezar-push did not answer on 127.0.0.1:$port — see: journalctl --user -u cezar-push -n 50"
