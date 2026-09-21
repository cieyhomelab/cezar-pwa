#!/usr/bin/env bash
# Installs the /m/ snippet into an existing nginx vhost. RUN THIS ON THE VPS.
#
#   sudo deploy/nginx/install.sh /etc/nginx/sites-available/cezar.ciey.studio
#
# Safe by construction: the vhost is backed up first, `nginx -t` gates the
# reload, and a config that fails the test is rolled back before nginx ever
# sees it. Re-running is a no-op apart from refreshing the snippet and the
# unlock guard (see extract-unlock.sh) — so re-run it after rotating the key.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

vhost="${1:-}"
[[ -n "$vhost" ]] || die "usage: $0 <path-to-vhost>  (e.g. /etc/nginx/sites-available/cezar.ciey.studio)"
[[ -f "$vhost" ]] || die "no such vhost file: $vhost"
[[ -w "$vhost" ]] || die "cannot write $vhost — run with sudo"
command -v nginx >/dev/null || die "nginx not found on PATH"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/cezar-mobile.conf"
[[ -f "$src" ]] || die "snippet not found next to this script: $src"
# Overridable so the install can be rehearsed against a scratch tree.
dest="${CEZAR_SNIPPET_DEST:-/etc/nginx/snippets/cezar-mobile.conf}"
# Must match the `include` glob in cezar-mobile.conf.
unlock_dest="${CEZAR_UNLOCK_DEST:-/etc/nginx/snippets/cezar-mobile-unlock.conf}"

install_snippet() {
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "==> wrote $dest"
}

# The /m/ copy of the vhost's `?key=` guard. Not fatal when it cannot be
# found: the shell still serves, it just cannot unlock — which is today's state.
install_unlock() {
  if "$here/extract-unlock.sh" "$vhost" "$unlock_dest"; then
    echo "==> wrote $unlock_dest (the /m/ unlock guard, copied from the vhost, mode 600)"
  else
    echo "warning: did not find exactly one 'if (\$arg_key = ...)' block with a Set-Cookie" >&2
    echo "         and a redirect in $vhost. /m/ will serve the shell, but the installed" >&2
    echo "         app cannot unlock itself. Copy that block into $unlock_dest by hand" >&2
    echo "         (mode 600) and re-run." >&2
  fi
}

# A broken unlock file must not be what stops the next reload of the gateway.
drop_unlock() {
  rm -f "$unlock_dest"
  echo "==> removed $unlock_dest" >&2
}

# Already wired up: just refresh the snippet contents and reload.
if grep -qF "$dest" "$vhost"; then
  echo "==> vhost already includes the snippet, refreshing it"
  install_snippet
  install_unlock
  nginx -t || { drop_unlock; die "nginx -t failed with the new snippet; $dest is updated but NOT loaded"; }
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
install_unlock

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
  drop_unlock
  echo "==> vhost restored from $backup" >&2
  nginx -t >/dev/null 2>&1 || echo "warning: the ORIGINAL vhost also fails nginx -t" >&2
  die "nginx -t failed; nothing was reloaded"
fi

systemctl reload nginx
echo "==> done. https://cezar.ciey.studio/m/ now serves the shell."
echo "    Rollback: cp -a $backup $vhost && nginx -t && systemctl reload nginx"
