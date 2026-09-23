#!/usr/bin/env bash
# Rehearses deploy/push/install.sh in a scratch $HOME: no VPS, no systemd, no
# root, no real build. A copy of the repo's deploy/ tree stands in for the
# checkout, and shims on PATH stand in for npm (writes a stub bundle),
# systemctl, loginctl and curl. Needs only bash and node.
#
#   deploy/push/rehearse.sh
#
# Checks what #36 got wrong: the unit the installer writes must point at
# CEZAR_PUSH_HOME and STATE_DIR, and the health probe must use the port the
# service will actually listen on. Exits non-zero on the first expectation
# that fails. Run it after touching deploy/push/install.sh or
# deploy/systemd/cezar-push.service.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
command -v node >/dev/null || { echo "node not on PATH" >&2; exit 2; }

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   $*"; }

# The scratch checkout: only the two files the installer reads, in the layout
# it resolves from its own location.
mkdir -p "$T/repo/deploy/push" "$T/repo/deploy/systemd" "$T/bin" "$T/home"
cp "$here/install.sh" "$T/repo/deploy/push/install.sh"
cp "$repo/deploy/systemd/cezar-push.service" "$T/repo/deploy/systemd/cezar-push.service"

# The port the unit itself asks for, so this script does not hard-code a
# default that the unit is free to change.
default_port=$(sed -n 's/^Environment=PORT=//p' "$T/repo/deploy/systemd/cezar-push.service" | tail -n 1)
[[ "$default_port" =~ ^[0-9]+$ ]] || fail "the unit has no Environment=PORT= default to rehearse against"

# Stands in for the bundle: real node runs it, so the rehearsal exercises the
# STATE_DIR the installer actually passes. Keeps an existing pair, as the real
# `cezar-push init` does.
cat >"$T/stub.mjs" <<'STUB'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
if (process.argv[2] !== 'init') { console.error('stub: expected `init`'); process.exit(1) }
const dir = process.env.STATE_DIR
if (!dir) { console.error('stub: no STATE_DIR in the environment'); process.exit(1) }
const file = join(dir, 'vapid.json')
mkdirSync(dir, { recursive: true, mode: 0o700 })
if (!existsSync(file)) writeFileSync(file, `{"publicKey":"stub-${Date.now()}","privateKey":"stub"}\n`, { mode: 0o600 })
console.log(`stub: VAPID keys at ${file}`)
STUB

cat >"$T/bin/npm" <<SHIM
#!/usr/bin/env bash
# The installer only wants the bundle on disk afterwards.
mkdir -p "$T/repo/apps/push-sidecar/dist"
cp "$T/stub.mjs" "$T/repo/apps/push-sidecar/dist/cezar-push.mjs"
SHIM
cat >"$T/bin/systemctl" <<SHIM
#!/usr/bin/env bash
echo "\$*" >>"$T/systemctl.log"
SHIM
cat >"$T/bin/loginctl" <<'SHIM'
#!/usr/bin/env bash
echo yes
SHIM
cat >"$T/bin/curl" <<SHIM
#!/usr/bin/env bash
# Only the URL matters here: it is what the probe got wrong.
echo "\$*" >>"$T/curl.log"
echo '{"subscriptions":0}'
SHIM
chmod +x "$T/bin/npm" "$T/bin/systemctl" "$T/bin/loginctl" "$T/bin/curl"

# A clean environment, so a STATE_DIR or PORT in the caller's shell cannot
# decide the outcome.
run_install() { # run_install [VAR=value ...]
  : >"$T/curl.log"
  env -i PATH="$T/bin:$PATH" HOME="$T/home" USER="${USER:-rehearsal}" "$@" \
    "$T/repo/deploy/push/install.sh" 2>&1
}
unit="$T/home/.config/systemd/user/cezar-push.service"
probed() { tr ' ' '\n' <"$T/curl.log" | grep '^http' || true; }

# --- the overrides reach the unit ------------------------------------------
out=$(run_install CEZAR_PUSH_HOME="$T/x" STATE_DIR="$T/y") || fail "install with overrides failed: $out"
[[ -f "$unit" ]] || fail "no unit at $unit"
for expected in \
  "WorkingDirectory=$T/x" \
  "ExecStart=/usr/bin/node $T/x/cezar-push.mjs" \
  "Environment=STATE_DIR=$T/y" \
  "EnvironmentFile=-$T/y/env"; do
  grep -qxF -- "$expected" "$unit" || fail "the installed unit has no '$expected':"$'\n'"$(grep -nE 'Directory|ExecStart|STATE_DIR|EnvironmentFile' "$unit")"
done
grep -v '^[[:space:]]*#' "$unit" | grep -q '%h' &&
  fail "a directive in the installed unit still carries %h — the service would use the defaults"
[[ -f "$T/x/cezar-push.mjs" ]] || fail "the bundle did not land in CEZAR_PUSH_HOME"
[[ -f "$T/y/vapid.json" ]] || fail "the VAPID keys did not land in STATE_DIR"
grep -q 'daemon-reload' "$T/systemctl.log" || fail "the installer did not reload systemd"
pass "CEZAR_PUSH_HOME and STATE_DIR reach WorkingDirectory, ExecStart, STATE_DIR and the EnvironmentFile"

# --- re-running upgrades without touching the keys -------------------------
keys=$(cat "$T/y/vapid.json")
out=$(run_install CEZAR_PUSH_HOME="$T/x" STATE_DIR="$T/y") || fail "re-running the installer failed: $out"
[[ "$(cat "$T/y/vapid.json")" == "$keys" ]] || fail "re-running replaced the VAPID keys — every device would be orphaned"
pass "re-running with the same overrides keeps the VAPID pair"

# --- the state directory ends up 0700, even if it was looser ---------------
mkdir -p "$T/loose"
chmod 755 "$T/loose"
out=$(run_install CEZAR_PUSH_HOME="$T/x2" STATE_DIR="$T/loose") || fail "install into an existing state dir failed: $out"
[[ "$(stat -c %a "$T/loose")" == 700 ]] || fail "the state directory is $(stat -c %a "$T/loose"), not 700"
pass "an existing state directory is tightened to 0700"

# --- the health probe follows the effective port ---------------------------
mkdir -p "$T/y3"
printf 'PORT=4444\n' >"$T/y3/env"
out=$(run_install CEZAR_PUSH_HOME="$T/x3" STATE_DIR="$T/y3") || fail "install with a port override failed: $out"
[[ "$(probed)" == "http://127.0.0.1:4444/m/push/health" ]] ||
  fail "the probe ignored PORT in the env file, it asked for: $(probed)"
pass "the health probe uses the PORT the env file sets, which systemd applies over the unit's own"

out=$(run_install CEZAR_PUSH_HOME="$T/x4" STATE_DIR="$T/y4") || fail "install without an env file failed: $out"
[[ "$(probed)" == "http://127.0.0.1:$default_port/m/push/health" ]] ||
  fail "with no env file the probe asked for: $(probed) (want the unit's $default_port)"
pass "with no env file the probe uses the unit's own PORT"

printf 'PORT=nonsense\n' >"$T/y3/env"
out=$(run_install CEZAR_PUSH_HOME="$T/x3" STATE_DIR="$T/y3") && fail "the installer accepted PORT=nonsense"
[[ "$out" == *"PORT is not a port"* ]] || fail "a bad PORT was not reported as such: $out"
pass "a PORT the service could not listen on is refused, not probed"

# --- the defaults still work ------------------------------------------------
rm -rf "${T:?}/home"
mkdir -p "$T/home"
out=$(run_install) || fail "install with no overrides failed: $out"
grep -qxF "WorkingDirectory=$T/home/cezar-push" "$unit" || fail "the default WorkingDirectory is wrong: $(grep ^WorkingDirectory= "$unit")"
grep -qxF "Environment=STATE_DIR=$T/home/.cezar-push" "$unit" || fail "the default STATE_DIR is wrong: $(grep STATE_DIR "$unit")"
[[ -f "$T/home/cezar-push/cezar-push.mjs" && -f "$T/home/.cezar-push/vapid.json" ]] ||
  fail "the default install did not put the bundle and the keys under \$HOME"
pass "with no overrides the unit, the bundle and the keys land under \$HOME"

# --- paths that cannot go in a unit file are refused ------------------------
for bad in 'relative/path' '/tmp/has space' '/tmp/has%specifier' '/tmp/has"quote' '/'; do
  out=$(run_install CEZAR_PUSH_HOME="$bad") && fail "the installer accepted CEZAR_PUSH_HOME=$bad"
  [[ "$out" == *CEZAR_PUSH_HOME* ]] || fail "refusing '$bad' did not name CEZAR_PUSH_HOME: $out"
  [[ -f "$T/repo/apps/push-sidecar/dist/cezar-push.mjs" ]] # the build must not even have been reached
  out=$(run_install STATE_DIR="$bad") && fail "the installer accepted STATE_DIR=$bad"
  [[ "$out" == *STATE_DIR* ]] || fail "refusing '$bad' did not name STATE_DIR: $out"
done
pass "a relative path, a space, a % specifier, a quote and / are all refused, naming the variable"

# --- a unit that stopped spelling its paths with %h is caught ---------------
# Without this the sed would silently no-op and the service would be back on
# the defaults — exactly the failure #36 describes.
sed -i "s#^WorkingDirectory=.*#WorkingDirectory=/opt/cezar-push#" "$T/repo/deploy/systemd/cezar-push.service"
out=$(run_install CEZAR_PUSH_HOME="$T/x9" STATE_DIR="$T/y9") && fail "the installer shipped a unit whose WorkingDirectory it could not set"
[[ "$out" == *"WorkingDirectory=$T/x9"* ]] || fail "the refusal did not say which setting it could not render: $out"
pass "a unit the installer cannot fully render is refused instead of installed"

echo "all expectations met"
