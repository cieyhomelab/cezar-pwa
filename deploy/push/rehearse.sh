#!/usr/bin/env bash
# Rehearses deploy/push/install.sh against a scratch $HOME: the paths it was
# told to use must reach the service, and the health probe must follow the port
# the service will really listen on (#36). Needs node and curl; no root, no VPS,
# no secret, and it never touches the live install — every run uses a scratch
# HOME, scratch state and a port of its own.
#
#   deploy/push/rehearse.sh [port]      (default 18490, and the next one)
#
# systemd is stood in for: a `systemctl` shim on PATH starts the installed unit
# the way the user manager would for the fields the install depends on
# (WorkingDirectory, ExecStart, Environment=, then EnvironmentFile= — so a value
# in the env file wins). Exits non-zero on the first expectation that fails.
# Run it after touching install.sh or deploy/systemd/cezar-push.service.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port="${1:-18490}"
command -v node >/dev/null || { echo "node not on PATH" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not on PATH" >&2; exit 2; }

T=$(mktemp -d)
cleanup() {
  if [[ -s "$T/service.pid" ]]; then kill "$(cat "$T/service.pid")" 2>/dev/null || true; fi
  rm -rf "$T"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   $*"; }
# The unit as installed, and one of its fields.
installed="$T/home/.config/systemd/user/cezar-push.service"
field() { sed -n "s/^$1=//p" "$installed" | tail -n1; }

mkdir -p "$T/bin" "$T/home"
cat >"$T/bin/systemctl" <<'SHIM'
#!/usr/bin/env bash
# Records every call; on `restart` runs the installed unit like systemd would.
set -euo pipefail
T="$CEZAR_REHEARSE_DIR"
echo "$*" >>"$T/systemctl.log"
[[ "${2:-}" == restart ]] || exit 0
[[ "${CEZAR_REHEARSE_START:-1}" == 1 ]] || exit 0

unit="$HOME/.config/systemd/user/cezar-push.service"
# %h is the user manager's own specifier, expanded here so an unrendered unit
# fails the way it would on the VPS — on the missing bundle, not on a literal.
field() { local v; v="$(sed -n "s/^$1=//p" "$unit" | tail -n1)"; echo "${v//%h/$HOME}"; }

if [[ -s "$T/service.pid" ]]; then kill "$(cat "$T/service.pid")" 2>/dev/null || true; fi

vars=()
while IFS= read -r line; do vars+=("${line//%h/$HOME}"); done < <(sed -n 's/^Environment=//p' "$unit")
env_file="$(field EnvironmentFile)"
if [[ -f "${env_file#-}" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] || vars+=("$line")
  done <"${env_file#-}"
fi

read -r -a argv <<<"$(field ExecStart)"
cd "$(field WorkingDirectory)"
nohup env "${vars[@]}" "${argv[@]}" >"$T/service.log" 2>&1 &
echo $! >"$T/service.pid"
SHIM
chmod +x "$T/bin/systemctl"

# Cezar itself is not part of this rehearsal: the watcher must be pointed at a
# port nothing answers on, so it backs off instead of reading the live instance.
dead_port=$((port + 2))
write_env() { # <state dir> [PORT value]
  mkdir -p "$1"
  { echo "CEZAR_URL=http://127.0.0.1:$dead_port"; [[ $# -lt 2 ]] || echo "PORT=$2"; } >"$1/env"
}

run_install() { # runs the real installer against this repo, in the scratch HOME
  HOME="$T/home" PATH="$T/bin:$PATH" CEZAR_REHEARSE_DIR="$T" \
    CEZAR_REHEARSE_START="${START:-1}" CEZAR_PUSH_HOME="${PUSH_HOME:-}" STATE_DIR="${PUSH_STATE:-}" \
    "$here/install.sh" 2>&1
}
restarts() { grep -c ' restart ' "$T/systemctl.log" 2>/dev/null || true; }

# 1. Overridden paths and an overridden port — the #36 case. The state dir is
# pre-created world-readable: the installer owes it 0700 (the sidecar's own
# mkdir would leave an existing directory as it found it).
PUSH_HOME="$T/elsewhere/bundle" PUSH_STATE="$T/elsewhere/state"
install -d -m 755 "$PUSH_STATE"
write_env "$PUSH_STATE" "$port"

out=$(run_install) ||
  fail "the installer failed with overridden paths: $out"$'\n'"service log: $(cat "$T/service.log" 2>/dev/null)"
[[ "$out" == *"healthy:"* ]] || fail "the installer did not reach a healthy probe: $out"
pass "install with CEZAR_PUSH_HOME and STATE_DIR set reports healthy"

[[ -f "$PUSH_HOME/cezar-push.mjs" ]] || fail "no bundle at $PUSH_HOME/cezar-push.mjs"
[[ -f "$PUSH_STATE/vapid.json" ]] || fail "no VAPID keys in $PUSH_STATE"
[[ ! -e "$T/home/cezar-push" && ! -e "$T/home/.cezar-push" ]] ||
  fail "the install also created the default paths — an override it cannot honour"
pass "the bundle and the keys are where the overrides asked, and nowhere else"

directives() { grep -v '^[[:space:]]*#' "$installed"; }
if directives | grep -q '%h'; then fail "a directive in the installed unit is still %h-relative: $(directives | grep '%h')"; fi
[[ "$(field WorkingDirectory)" == "$PUSH_HOME" ]] || fail "WorkingDirectory=$(field WorkingDirectory)"
[[ "$(field ExecStart)" == */node" $PUSH_HOME/cezar-push.mjs" ]] || fail "ExecStart=$(field ExecStart)"
grep -qx "Environment=STATE_DIR=$PUSH_STATE" "$installed" || fail "the unit does not carry STATE_DIR=$PUSH_STATE"
grep -qx "EnvironmentFile=-$PUSH_STATE/env" "$installed" || fail "the unit reads an env file the install did not write"
pass "the installed unit points at the overridden bundle, state dir and env file"

[[ "$(stat -c %a "$PUSH_STATE")" == 700 ]] || fail "the state dir is $(stat -c %a "$PUSH_STATE"), not 700"
pass "an existing state directory is tightened to 0700"

[[ "$out" == *"port $port)"* ]] || fail "the installer did not report the env file's port: $out"
grep -q "listening on 127.0.0.1:$port" "$T/service.log" ||
  fail "the service did not listen on the env file's port: $(cat "$T/service.log")"
[[ "$(curl -fsS "http://127.0.0.1:$port/m/push/health")" == *'"subscriptions"'* ]] ||
  fail "the health answer on $port does not look like the sidecar's"
pass "PORT from the env file is what the service listens on and what the probe reads"

# 2. No overrides: the default route through the same rendering still works.
next=$((port + 1))
PUSH_HOME='' PUSH_STATE=''
write_env "$T/home/.cezar-push" "$next"
out=$(run_install) || fail "the installer failed with default paths: $out"$'\n'"service log: $(cat "$T/service.log")"
[[ "$out" == *"healthy:"* && "$out" == *"port $next)"* ]] || fail "the default install did not come up on $next: $out"
[[ "$(field WorkingDirectory)" == "$T/home/cezar-push" ]] || fail "WorkingDirectory=$(field WorkingDirectory) with no override"
grep -qx "Environment=STATE_DIR=$T/home/.cezar-push" "$installed" || fail "the default state dir is not in the unit"
grep -q "listening on 127.0.0.1:$next" "$T/service.log" || fail "the default install did not listen on $next"
pass "with no overrides the unit and the probe follow \$HOME and the env file"

# 3. No PORT in the env file: the probe falls back to the unit's own default.
# Nothing is started and the probe's outcome is not asserted — 4330 is where a
# real cezar-push would be, and this rehearsal only ever binds a port it chose;
# what is checked is the port the installer picked.
default_port=$(sed -n 's/^Environment=PORT=\([0-9]*\)$/\1/p' "$here/../systemd/cezar-push.service" | tail -n1)
[[ -n "$default_port" ]] || fail "the unit in the repo has no Environment=PORT="
write_env "$T/home/.cezar-push"
out=$(START=0 run_install) || true
[[ "$out" == *"port $default_port)"* ]] || fail "with no PORT in the env file the installer did not fall back to $default_port: $out"
pass "with no PORT set the installer probes the unit's own default ($default_port)"

# 4. A PORT the sidecar would refuse: the installer must say so instead of
# restarting the service and probing something it cannot have bound.
write_env "$T/home/.cezar-push" "not-a-port"
before=$(restarts)
out=$(run_install) && fail "the installer accepted PORT=not-a-port: $out"
[[ "$out" == *"is not a port"* ]] || fail "the refusal does not name the problem: $out"
[[ "$(restarts)" == "$before" ]] || fail "the installer restarted the service with a PORT it had already rejected"
pass "an unusable PORT in the env file is refused before the service is restarted"

# 5. An override systemd could not take either: refused up front, before the
# bundle is even built.
write_env "$T/home/.cezar-push" "$next"
before=$(restarts)
out=$(PUSH_HOME="relative/bundle" run_install) && fail "the installer accepted a relative CEZAR_PUSH_HOME: $out"
[[ "$out" == *"must be absolute"* ]] || fail "the refusal does not say why: $out"
[[ "$(restarts)" == "$before" ]] || fail "the installer restarted the service with a path it had already rejected"
[[ ! -e "relative/bundle" && ! -e "$here/relative" ]] || fail "the installer created a relative path anyway"
pass "a relative CEZAR_PUSH_HOME is refused, and nothing is installed or restarted"

echo "all expectations met"
