#!/usr/bin/env bash
# Installs the /m/ snippet into an existing nginx vhost. RUN THIS ON THE VPS.
#
#   sudo deploy/nginx/install.sh /etc/nginx/sites-available/cezar.ciey.studio
#
# Safe by construction: the vhost is backed up first, `nginx -t` gates the
# reload, and a config that fails the test is rolled back before nginx ever
# sees it. Re-running is a no-op apart from refreshing the snippet.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

vhost="${1:-}"
[[ -n "$vhost" ]] || die "usage: $0 <path-to-vhost>  (e.g. /etc/nginx/sites-available/cezar.ciey.studio)"
[[ -f "$vhost" ]] || die "no such vhost file: $vhost"
[[ -w "$vhost" ]] || die "cannot write $vhost — run with sudo"
command -v nginx >/dev/null || die "nginx not found on PATH"

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cezar-mobile.conf"
[[ -f "$src" ]] || die "snippet not found next to this script: $src"
# Overridable so the install can be rehearsed against a scratch tree.
dest="${CEZAR_SNIPPET_DEST:-/etc/nginx/snippets/cezar-mobile.conf}"

install_snippet() {
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "==> wrote $dest"
}

# Already wired up: just refresh the snippet contents and reload.
if grep -qF "$dest" "$vhost"; then
  echo "==> vhost already includes the snippet, refreshing it"
  install_snippet
  nginx -t || die "nginx -t failed with the new snippet; $dest is updated but NOT loaded"
  systemctl reload nginx
  echo "==> reloaded"
  exit 0
fi

# Only touch a vhost whose shape is unambiguous. Guessing which of several
# server blocks to edit is how a gateway goes down.
matches=$(grep -cE '^[[:space:]]*location[[:space:]]+/[[:space:]]*\{' "$vhost" || true)
[[ "$matches" == "1" ]] || die "found $matches 'location / {' blocks in $vhost; add 'include $dest;' by hand inside the right server block"

backup="$vhost.bak.$(date +%Y%m%d-%H%M%S)"
cp -a "$vhost" "$backup"
echo "==> backed up to $backup"

install_snippet

# Placed just above `location /` so the file reads in priority order. nginx
# does not need it there — `^~ /m/` wins on its own — but a human reading the
# vhost later should see the more specific route first.
awk -v inc="    include $dest;" '
  !inserted && /^[[:space:]]*location[[:space:]]+\/[[:space:]]*\{/ { print inc; print ""; inserted=1 }
  { print }
' "$backup" > "$vhost"

grep -qF "$dest" "$vhost" || { cp -a "$backup" "$vhost"; die "insertion produced no include line; vhost restored"; }

if ! nginx -t; then
  cp -a "$backup" "$vhost"
  echo "==> vhost restored from $backup" >&2
  nginx -t >/dev/null 2>&1 || echo "warning: the ORIGINAL vhost also fails nginx -t" >&2
  die "nginx -t failed; nothing was reloaded"
fi

systemctl reload nginx
echo "==> done. https://cezar.ciey.studio/m/ now serves the shell."
echo "    Rollback: cp -a $backup $vhost && nginx -t && systemctl reload nginx"
