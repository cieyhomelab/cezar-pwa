#!/usr/bin/env bash
# Rehearses the /m/ snippet against a scratch nginx laid out like the live
# gateway: `location /` includes snippets/cezar-gate.conf, which holds the
# `?key=` guard and a cookie check on a `map` variable defined at http level
# (conf.d/cezar-gate.conf). Needs nginx on PATH; no root, no VPS, no secret.
#
#   deploy/nginx/rehearse.sh [port]      (default 18480)
#
# Exits non-zero on the first expectation that fails. Run it after touching
# cezar-mobile.conf, install.sh or extract-unlock.sh.
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

ng -t 2>/dev/null || fail "nginx -t fails with the extracted guard"
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

echo "all expectations met"
