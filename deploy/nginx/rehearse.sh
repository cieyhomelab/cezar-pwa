#!/usr/bin/env bash
# Rehearses the /m/ snippet against a scratch nginx laid out like the live
# gateway: `location /` includes snippets/cezar-gate.conf, which holds the
# `?key=` guard and a cookie check on a `map` variable defined at http level
# (conf.d/cezar-gate.conf). Needs nginx on PATH; no root, no VPS, no secret.
#
#   deploy/nginx/rehearse.sh [port]      (default 18480)
#
# Exits non-zero on the first expectation that fails. Run it after touching
# cezar-mobile.conf, install.sh, extract-unlock.sh or signout-from-unlock.sh.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port="${1:-18480}"
command -v nginx >/dev/null || { echo "nginx not on PATH" >&2; exit 2; }

T=$(mktemp -d)
ng() { nginx -e "$T/logs/error.log" -p "$T" -c "$T/nginx.conf" "$@"; }
cleanup() { ng -s stop 2>/dev/null || true; rm -rf "$T"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   $*"; }

# A base64-style key on purpose: `/`, `+` and `=` are what a client that
# re-encodes the query gets wrong.
KEY='Zm9v/YmFy+cXV4=='
ENCODED='Zm9v%2FYmFy+cXV4%3D%3D'
base="http://127.0.0.1:$port"

mkdir -p "$T/www" "$T/snippets" "$T/logs"
echo '<!doctype html><title>shell</title>' >"$T/www/index.html"

cat >"$T/snippets/cezar-gate.conf" <<GATE
# Unlock link: /?key=<secret> plants the cookie, then redirects to the clean URL.
if (\$arg_key = "$KEY") {
    add_header Set-Cookie "cezar_access=$KEY; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax";
    return 302 http://\$http_host\$uri;
}

# No cookie, or a stale one: refuse before anything reaches the cockpit.
if (\$cezar_gate_ok = 0) {
    return 403 "forbidden\\n";
}
GATE

cat >"$T/vhost.conf" <<VHOST
# Stands in for cezar-push on the next port.
server {
    listen 127.0.0.1:$((port + 1));
    location / {
        default_type application/json;
        return 200 '{"sidecar":"\$request_uri"}';
    }
}

server {
    listen 127.0.0.1:$port;
    include $T/snippets/cezar-mobile.conf;

    location / {
        include $T/snippets/cezar-gate.conf;
        return 200 "cockpit\\n";
    }
}
VHOST

sed -e "s#/var/www/cezar-mobile/#$T/www/#" -e "s#/etc/nginx/snippets/#$T/snippets/#g" \
  -e "s#http://127.0.0.1:4330#http://127.0.0.1:$((port + 1))#" \
  "$here/cezar-mobile.conf" >"$T/snippets/cezar-mobile.conf"

cat >"$T/nginx.conf" <<CONF
pid $T/nginx.pid;
error_log $T/logs/error.log;
events {}
http {
    access_log off;
    default_type text/html;
    client_body_temp_path $T/body; proxy_temp_path $T/proxy; fastcgi_temp_path $T/fcgi;
    uwsgi_temp_path $T/uwsgi; scgi_temp_path $T/scgi;
    map \$cookie_cezar_access \$cezar_gate_ok {
        default 0;
        "$KEY" 1;
    }
    include $T/vhost.conf;
}
CONF

# Status, Location and whether a Set-Cookie came back — never the cookie itself.
probe() {
  curl -s -o /dev/null -D - "$@" | tr -d '\r' | awk '
    /^HTTP/ { status = $2 }
    tolower($1) == "location:" { location = $2 }
    tolower($1) == "set-cookie:" { cookie = "yes" }
    tolower($1) == "content-security-policy:" { csp = "yes" }
    END { printf "%s %s %s %s\n", status, (location ? location : "-"), (cookie ? cookie : "no"), (csp ? csp : "no") }'
}

ng -t 2>/dev/null || fail "nginx -t fails with no unlock file — the include glob must tolerate its absence"
pass "config is valid before the unlock guard exists"

printed=$("$here/extract-unlock.sh" "$T/vhost.conf" "$T/snippets/cezar-mobile-unlock.conf")
[[ -z "$printed" ]] || fail "extract-unlock.sh printed output — it must never echo the secret"
[[ "$(stat -c %a "$T/snippets/cezar-mobile-unlock.conf")" == 600 ]] || fail "unlock file is not mode 600"
grep -q 'cezar-gate.conf' "$T/snippets/cezar-mobile-unlock.conf" || fail "guard was not found through the vhost's include"
grep -q 'cezar_gate_ok' "$T/snippets/cezar-mobile-unlock.conf" && fail "the cookie check was copied too — /m/ would 403 without a session"
pass "guard found through the vhost's include, extracted silently, mode 600, cookie check left behind"

printed=$("$here/signout-from-unlock.sh" "$T/snippets/cezar-mobile-unlock.conf" "$T/snippets/cezar-mobile-signout.conf")
[[ -z "$printed" ]] || fail "signout-from-unlock.sh printed output — it reads the guard and must never echo it"
grep -qF "$KEY" "$T/snippets/cezar-mobile-signout.conf" && fail "the sign-out file carries the secret"
grep -q 'cezar_access=;' "$T/snippets/cezar-mobile-signout.conf" || fail "sign-out does not expire the gate's own cookie name"
grep -q 'Secure' "$T/snippets/cezar-mobile-signout.conf" && fail "sign-out marks Secure a cookie the gate did not"
pass "sign-out generated from the guard: the gate's cookie name, no secret, attributes kept"

ng -t 2>/dev/null || fail "nginx -t fails with the extracted guard and the sign-out"
ng

read -r status location cookie _ < <(probe "$base/m/?key=$KEY")
[[ "$status" == 302 && "$location" == */m/ && "$cookie" == yes ]] ||
  fail "/m/?key=<raw> → $status $location cookie=$cookie (want 302 …/m/ with a cookie)"
pass "/m/?key=<raw key> → 302 back to /m/ with the session cookie"

read -r status _ cookie _ < <(probe "$base/m/?key=$ENCODED")
[[ "$status" == 200 && "$cookie" == no ]] ||
  fail "/m/?key=<re-encoded> → $status cookie=$cookie (nginx compares raw bytes; want 200, no cookie)"
pass "/m/?key=<re-encoded key> is not accepted — the client must send it raw"

read -r status _ cookie csp < <(probe "$base/m/?key=wrong")
[[ "$status" == 200 && "$cookie" == no && "$csp" == yes ]] ||
  fail "/m/?key=wrong → $status cookie=$cookie csp=$csp (want the shell, no cookie, CSP intact)"
pass "a wrong key gets the shell with its CSP, and no cookie"

read -r status _ _ _ < <(probe "$base/")
[[ "$status" == 403 ]] || fail "/ without a cookie → $status (want 403)"
pass "the cockpit is still gated"

jar="$T/jar"
landed=$(curl -s -o /dev/null -c "$jar" -L -w '%{url_effective} %{http_code}' "$base/m/?key=$KEY")
[[ "$landed" == "$base/m/ 200" ]] || fail "following the unlock landed on: $landed"
gated=$(curl -s -o /dev/null -b "$jar" -w '%{http_code}' "$base/")
[[ "$gated" == 200 ]] || fail "the session from /m/ does not open the gate: $gated"
pass "unlocking at /m/ lands on /m/ and the session opens the gate"

read -r status _ _ _ < <(probe "$base/m/push/vapid-public-key")
[[ "$status" == 403 ]] || fail "/m/push/ without a session → $status (want 403, never proxied)"
pass "the push sidecar is gated like the cockpit"

read -r status _ cookie _ < <(probe "$base/m/push/vapid-public-key?key=$KEY")
[[ "$status" == 403 && "$cookie" == no ]] ||
  fail "/m/push/?key= → $status cookie=$cookie (the sidecar path must not unlock; want 403)"
pass "the sidecar path does not carry the unlock guard"

pushed=$(curl -s -b "$jar" "$base/m/push/vapid-public-key")
[[ "$pushed" == '{"sidecar":"/m/push/vapid-public-key"}' ]] ||
  fail "with a session, /m/push/ did not reach the sidecar with its full path: $pushed"
pass "with a session, /m/push/ reaches the sidecar, path intact"

# S-12 sign-out. Only a same-origin POST ends the session.
read -r status _ cookie _ < <(probe "$base/m/session/end")
[[ "$status" == 405 && "$cookie" == no ]] || fail "GET /m/session/end → $status cookie=$cookie (want 405, no cookie)"
pass "GET /m/session/end is refused: a prefetch or a pasted link cannot sign out"

read -r status _ cookie _ < <(probe -X POST "$base/m/session/end")
[[ "$status" == 403 && "$cookie" == no ]] || fail "POST without Origin → $status cookie=$cookie (want 403)"
read -r status _ cookie _ < <(probe -X POST -H 'Origin: https://evil.example' "$base/m/session/end")
[[ "$status" == 403 && "$cookie" == no ]] || fail "cross-site POST → $status cookie=$cookie (want 403)"
pass "a POST from another origin, or with none, is refused"

read -r status _ cookie csp < <(probe -X POST -H "Origin: $base" "$base/m/session/end")
[[ "$status" == 204 && "$cookie" == yes && "$csp" == yes ]] ||
  fail "same-origin POST /m/session/end → $status cookie=$cookie csp=$csp (want 204 with a Set-Cookie and the CSP)"
pass "a same-origin POST answers 204 with a Set-Cookie, security headers intact"

ended=$(curl -s -o /dev/null -b "$jar" -c "$jar" -X POST -H "Origin: $base" -w '%{http_code}' "$base/m/session/end")
[[ "$ended" == 204 ]] || fail "signing out with a session → $ended (want 204)"
gated=$(curl -s -o /dev/null -b "$jar" -w '%{http_code}' "$base/")
[[ "$gated" == 403 ]] || fail "after signing out the cockpit still opens: $gated (want 403)"
gated=$(curl -s -o /dev/null -b "$jar" -w '%{http_code}' "$base/m/push/vapid-public-key")
[[ "$gated" == 403 ]] || fail "after signing out the sidecar still answers: $gated (want 403)"
shell=$(curl -s -o /dev/null -b "$jar" -w '%{http_code}' "$base/m/")
[[ "$shell" == 200 ]] || fail "after signing out the shell is gone: $shell (want 200 — it shows Connect to Cezar)"
pass "after signing out the session is gone: cockpit and sidecar 403, the shell still loads"

# install.sh's refresh path, run for real against this tree. It calls `nginx`
# and `systemctl` by name, so shims on PATH point both at the scratch nginx;
# a copy of the installer next to the scratch snippet stands in for the repo.
real_nginx=$(command -v nginx)
mkdir -p "$T/bin" "$T/installer" "$T/good"
cat >"$T/bin/nginx" <<SHIM
#!/usr/bin/env bash
exec "$real_nginx" -e "$T/logs/error.log" -p "$T" -c "$T/nginx.conf" "\$@"
SHIM
cat >"$T/bin/systemctl" <<SHIM
#!/usr/bin/env bash
echo "\$*" >>"$T/reloads"
exec "$real_nginx" -e "$T/logs/error.log" -p "$T" -c "$T/nginx.conf" -s reload
SHIM
chmod +x "$T/bin/nginx" "$T/bin/systemctl"
cp "$here/install.sh" "$here/extract-unlock.sh" "$here/signout-from-unlock.sh" "$T/installer/"
cp "$T/snippets/cezar-mobile.conf" "$T/installer/cezar-mobile.conf"

run_install() {
  PATH="$T/bin:$PATH" CEZAR_SNIPPET_DEST="$T/snippets/cezar-mobile.conf" \
    CEZAR_UNLOCK_DEST="$T/snippets/cezar-mobile-unlock.conf" \
    CEZAR_SIGNOUT_DEST="$T/snippets/cezar-mobile-signout.conf" \
    "$T/installer/install.sh" "$T/vhost.conf" 2>&1
}
reloads() { if [[ -f "$T/reloads" ]]; then wc -l <"$T/reloads"; else echo 0; fi; }

out=$(run_install) || fail "refreshing with a good snippet failed: $out"
[[ "$out" == *"refreshing it"* && "$(reloads)" == 1 ]] || fail "a good refresh did not take the refresh path and reload once: $out"
[[ "$out" == *"$KEY"* ]] && fail "install.sh printed the secret"
for f in cezar-mobile.conf cezar-mobile-unlock.conf cezar-mobile-signout.conf; do cp -a "$T/snippets/$f" "$T/good/$f"; done
[[ "$(probe "$base/m/?key=$KEY" | cut -d' ' -f1)" == 302 ]] || fail "after a good refresh /m/ no longer unlocks"
pass "a refresh with a good snippet writes the three files and reloads once"

echo 'not_a_directive on;' >>"$T/installer/cezar-mobile.conf"
out=$(run_install) && fail "install.sh exited 0 with a snippet that fails nginx -t"
[[ "$out" == *"nginx -t passes again"* ]] || fail "a failed refresh did not confirm nginx -t passes again: $out"
[[ "$out" == *"$KEY"* ]] && fail "install.sh printed the secret on the failure path"
for f in cezar-mobile.conf cezar-mobile-unlock.conf cezar-mobile-signout.conf; do
  cmp -s "$T/good/$f" "$T/snippets/$f" || fail "a failed refresh left a different $f on disk"
done
[[ "$(stat -c %a "$T/snippets/cezar-mobile-unlock.conf")" == 600 ]] || fail "the restored unlock file is not mode 600"
ng -t 2>/dev/null || fail "nginx -t fails after a failed refresh — the next reload would take the gateway down"
[[ "$(reloads)" == 1 ]] || fail "a failed refresh reloaded nginx"
[[ "$(probe "$base/m/?key=$KEY" | cut -d' ' -f1)" == 302 ]] || fail "after a failed refresh /m/ no longer unlocks"
pass "a refresh with a broken snippet restores the good snippet, unlock and sign-out; nginx -t passes; no reload"

rm "$T/snippets/cezar-mobile-unlock.conf" "$T/snippets/cezar-mobile-signout.conf"
out=$(run_install) && fail "install.sh exited 0 with a snippet that fails nginx -t"
[[ ! -e "$T/snippets/cezar-mobile-unlock.conf" && ! -e "$T/snippets/cezar-mobile-signout.conf" ]] ||
  fail "a failed refresh left unlock or sign-out files that were not there before"
cmp -s "$T/good/cezar-mobile.conf" "$T/snippets/cezar-mobile.conf" || fail "a failed refresh left the broken snippet on disk"
ng -t 2>/dev/null || fail "nginx -t fails after a failed refresh with no unlock file"
pass "a failed refresh removes the unlock and sign-out files it created, and nothing else changes"

echo "all expectations met"
