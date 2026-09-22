#!/usr/bin/env bash
# Installs the /m/ snippet into an existing nginx vhost. RUN THIS ON THE VPS.
#
#   sudo deploy/nginx/install.sh /etc/nginx/sites-available/cezar.ciey.studio
#
# Safe by construction: the vhost and every file this script writes are backed
# up first, `nginx -t` gates the reload, and a config that fails the test is
# rolled back — on a first install and on a refresh alike — so nothing invalid
# is left for a later reload to pick up. Re-running is a no-op apart from refreshing the snippet, the
# unlock guard (see extract-unlock.sh) and the sign-out derived from it
# (signout-from-unlock.sh) — so re-run it after rotating the key.
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
# Likewise, for the sign-out endpoint (S-12).
signout_dest="${CEZAR_SIGNOUT_DEST:-/etc/nginx/snippets/cezar-mobile-signout.conf}"

install_snippet() {
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "==> wrote $dest"
}

# The /m/ copy of the vhost's `?key=` guard. Not fatal when it cannot be
# found: the shell still serves, it just cannot unlock — which is today's state.
# The sign-out is derived from it, so it follows: no guard, no sign-out.
install_unlock() {
  if "$here/extract-unlock.sh" "$vhost" "$unlock_dest"; then
    echo "==> wrote $unlock_dest (the /m/ unlock guard, copied from the vhost, mode 600)"
    if "$here/signout-from-unlock.sh" "$unlock_dest" "$signout_dest"; then
      echo "==> wrote $signout_dest (POST /m/session/end expires the session cookie)"
    else
      rm -f "$signout_dest"
      echo "warning: no cookie name in the unlock guard's Set-Cookie; the app's sign-out" >&2
      echo "         will clear the phone but cannot end the session." >&2
    fi
  else
    rm -f "$signout_dest"
    echo "warning: did not find exactly one 'if (\$arg_key = ...)' block with a Set-Cookie" >&2
    echo "         and a redirect in $vhost or the files it includes. /m/ will serve" >&2
    echo "         the shell, but the installed" >&2
    echo "         app cannot unlock itself. Copy that block into $unlock_dest by hand" >&2
    echo "         (mode 600) and re-run." >&2
  fi
}

# The files this script writes, saved before it writes them. A config that
# fails `nginx -t` must not stay on disk: the next reload — a reboot, a certbot
# hook, `cezar server-install` — would pick it up and take the gateway down.
# The stash lives in a mode-700 mktemp dir; `cp -a` keeps the unlock file 600.
written=("$dest" "$unlock_dest" "$signout_dest")
stash=$(mktemp -d)
trap 'rm -rf "$stash"' EXIT
for i in "${!written[@]}"; do
  if [[ -e "${written[$i]}" ]]; then cp -a "${written[$i]}" "$stash/$i"; fi
done

# Puts every written file back as it was, removing the ones that did not exist.
restore_written() {
  for i in "${!written[@]}"; do
    if [[ -e "$stash/$i" ]]; then cp -a "$stash/$i" "${written[$i]}"; else rm -f "${written[$i]}"; fi
  done
  echo "==> restored the previous $dest, $unlock_dest and $signout_dest" >&2
}

# Already wired up: just refresh the snippet contents and reload.
if grep -qF "$dest" "$vhost"; then
  echo "==> vhost already includes the snippet, refreshing it"
  install_snippet
  install_unlock
  if ! nginx -t; then
    restore_written
    nginx -t >/dev/null 2>&1 ||
      die "nginx -t failed with the new snippet, and STILL fails with the previous files restored — do not reload nginx until that is fixed"
    die "nginx -t failed with the new snippet; the previous files are restored, nginx -t passes again, nothing was reloaded"
  fi
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

grep -qF "$dest" "$vhost" || { cp -a "$backup" "$vhost"; restore_written; die "insertion produced no include line; vhost restored"; }

if ! nginx -t; then
  cp -a "$backup" "$vhost"
  restore_written
  echo "==> vhost restored from $backup" >&2
  nginx -t >/dev/null 2>&1 || echo "warning: the ORIGINAL vhost also fails nginx -t" >&2
  die "nginx -t failed; nothing was reloaded"
fi

systemctl reload nginx
echo "==> done. https://cezar.ciey.studio/m/ now serves the shell."
echo "    Rollback: cp -a $backup $vhost && nginx -t && systemctl reload nginx"
