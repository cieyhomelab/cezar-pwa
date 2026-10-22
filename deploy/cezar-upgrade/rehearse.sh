#!/usr/bin/env bash
# Rehearses deploy/cezar-upgrade/ in a scratch $HOME: no VPS, no cockpit, no GitHub,
# no systemd. Shims on PATH stand in for curl, npm, git, gh, npx (the cez CLI), id,
# systemctl and systemd-run; scenario variables drive what they answer. Needs bash
# and python3; node only for the graph check below.
#
#   deploy/cezar-upgrade/rehearse.sh            (KEEP=1 keeps the scratch dir for a look)
#
# Checks install.sh (files, env, workflow copy, automation created once and then
# updated), every exit code of state.sh and what it leaves in the lock, that
# schedule-host.sh schedules the transient unit only when the host is behind, and
# that unlock.sh releases only its own run's lock. When a cezar-cli is in the npx
# cache, the workflow graph is also loaded with Cezar's own loader and every route
# walked. Exits non-zero on the first expectation that fails. Run it after touching
# anything in deploy/cezar-upgrade/.
# The shim bodies below are scripts in their own right: their $vars expand when a shim
# runs, not here, so they are single-quoted on purpose.
# shellcheck disable=SC2016
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo "python3 not on PATH" >&2; exit 2; }
real_home="$HOME"

T=$(mktemp -d)
trap '[[ -n "${KEEP:-}" ]] && echo "kept $T" || rm -rf "$T"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   $*"; }

# The scratch checkout (the installer resolves the repo from its own location),
# the cockpit project's checkout, and the home the scripts run in.
mkdir -p "$T/repo/deploy" "$T/project" "$T/bin" "$T/home/.cezar" "$T/home/.cezar-push"
cp -r "$here" "$T/repo/deploy/cezar-upgrade"
cat >"$T/home/.cezar/config.json" <<EOF
{ "projects": [ { "id": "cezar-pwa", "root": "$T/project" } ] }
EOF
echo "PUBLIC_ORIGIN=https://pwa.example.test" >"$T/home/.cezar-push/env"
: >"$T/calls.log"

# --- shims: each logs its argv and answers from FAKE_* ---
shim() { printf '#!/usr/bin/env bash\necho "%s $*" >>"$T/calls.log"\n%s\n' "$1" "$2" >"$T/bin/$1"; chmod +x "$T/bin/$1"; }
shim id 'if [[ "${1:-}" == -u ]]; then echo 1000; else /usr/bin/id "$@"; fi'
shim curl 'echo "{\"version\":\"$FAKE_HOST\"}"'
shim npm 'case "$*" in *dist-tags.latest*) echo "$FAKE_LATEST";; *gitHead*) echo "$FAKE_SHA";; esac'
shim git 'args="$*"
case "$args" in
  *"remote get-url origin"*) echo "https://github.com/acme/cezar-pwa.git";;
  ls-remote*) [[ -n "${FAKE_TAG:-}" ]] && printf "%s\trefs/tags/v%s\n" "$FAKE_TAG" "$FAKE_LATEST";;
  *fetch*) ;;
  *"show origin/main:packages/cezar-contract/UPSTREAM"*) echo "$FAKE_PIN_SHA";;
  *"show origin/main:apps/pwa/src/config/cezar-compat.ts"*) echo "export const TESTED_CEZAR_VERSION = '"'"'$FAKE_PIN'"'"'";;
  *) exit 1;;
esac'
shim gh 'case "$1 $2" in
  "pr list") echo "${FAKE_OPEN_PR:-}";;
  "issue list") echo "${FAKE_OPEN_ISSUE:-}";;
  "issue view") echo "${FAKE_ISSUE_STATE:-OPEN}";;
  "issue comment") ;;
  *) exit 1;;
esac'
shim npx 'db="$T/automations"; touch "$db"
case "$4" in
  list) cat "$db";;
  create) echo "11111111-2222-3333-4444-555555555555  enabled  every day at 06:00  next x  Cezar upgrade: host + PWA sync" >"$db";;
  update) ;;
  *) exit 1;;
esac'
shim systemctl 'case "$*" in *" cat "*) ;; *is-active*|*is-activating*) exit 3;; *) ;; esac'
shim systemd-run ''
sed -i "s#\$T#$T#g" "$T"/bin/*

export PATH="$T/bin:$PATH" HOME="$T/home"
export FAKE_HOST=0.16.2 FAKE_LATEST=0.16.2 FAKE_SHA=3cfb655002670258c93e3e76881f477145c4740b
export FAKE_PIN=0.16.2 FAKE_PIN_SHA=3cfb655002670258c93e3e76881f477145c4740b
unset CEZ_RUN_ID CEZ_UPGRADE_DRY_RUN
dir="$T/home/cezar-upgrade"
lock="$dir/run.lock"

# --- install.sh ---
"$T/repo/deploy/cezar-upgrade/install.sh" >"$T/install1.out" 2>&1 || { cat "$T/install1.out"; fail "install.sh (first run)"; }
for f in state.sh schedule-host.sh unlock.sh upgrade-cezar.sh; do
  [[ -x "$dir/$f" ]] || fail "install.sh did not install $f"
done
[[ "$(stat -c %a "$dir/env")" == 600 ]] || fail "env is not mode 600"
grep -qx 'CEZAR_REPO=acme/cezar-pwa' "$dir/env" || fail "CEZAR_REPO not taken from origin"
grep -qx 'PUBLIC_ORIGIN=https://pwa.example.test' "$dir/env" || fail "PUBLIC_ORIGIN not taken from ~/.cezar-push/env"
grep -qx 'CEZAR_API=http://127.0.0.1:4321/api/v1' "$dir/env" || fail "CEZAR_API wrong"
cmp -s "$here/cezar-upgrade.yaml" "$T/project/.ai/cezar/workflows/cezar-upgrade.yaml" || fail "workflow not copied into the project"
grep -q 'npx --yes cezar-cli@0.16.2 automation create --file .*--enable' "$T/calls.log" || fail "automation not created with the host's CLI version"
pass "install.sh: scripts, env (600), workflow, automation created"

"$T/repo/deploy/cezar-upgrade/install.sh" >"$T/install2.out" 2>&1 || { cat "$T/install2.out"; fail "install.sh (second run)"; }
grep -q 'automation update 11111111-2222-3333-4444-555555555555 --file' "$T/calls.log" || fail "second run did not update the existing automation"
[[ $(grep -c 'automation create' "$T/calls.log") == 1 ]] || fail "second run created a duplicate automation"
pass "install.sh: re-run updates in place"

mkdir "$lock"
if "$T/repo/deploy/cezar-upgrade/install.sh" >/dev/null 2>&1; then fail "install.sh ran while a lock was held"; fi
rmdir "$lock"
pass "install.sh: refuses while a run holds the lock"

# --- state.sh ---
state() { set +e; (cd "$T/project" && CEZ_WORKTREE="$T/project" "$dir/state.sh") >"$T/state.out" 2>&1; rc=$?; set -e; }

CEZ_RUN_ID=run-a; export CEZ_RUN_ID
state
[[ $rc == 1 ]] || { cat "$T/state.out"; fail "current host and pin: exit $rc, want 1"; }
grep -q 'nothing to do: Cezar 0.16.2' "$T/state.out" || fail "nothing-to-do message missing"
[[ ! -d "$lock" ]] || fail "nothing to do left the lock behind"
pass "state.sh: current → 1, lock released"

FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
[[ $rc == 0 ]] || { cat "$T/state.out"; fail "host and pin behind: exit $rc, want 0"; }
grep -q 'issue title: Chore: upgrade the host to Cezar 0.17.0 and sync the PWA to it (aaaaaaa)' "$T/state.out" || fail "wrong title for host+PWA"
[[ "$(cat "$lock/owner")" == run-a ]] || fail "lock owner not recorded"
{ grep -qx 'NEED_HOST=1' "$lock/state.env" && grep -qx 'NEED_PR=1' "$lock/state.env"; } || fail "state.env needs wrong"
pass "state.sh: behind → 0, lock + state.env kept"

CEZ_RUN_ID=run-b state
[[ $rc == 2 ]] || fail "fresh lock held by another run: exit $rc, want 2"
[[ "$(cat "$lock/owner")" == run-a ]] || fail "a refused run touched the other run's lock"
pass "state.sh: lock held → 2, lock untouched"

touch -d '7 hours ago' "$lock"
CEZ_RUN_ID=run-b FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
[[ $rc == 0 && "$(cat "$lock/owner")" == run-b ]] || { cat "$T/state.out"; fail "stale lock not taken over (exit $rc)"; }
rm -rf "$lock"
pass "state.sh: stale lock (>6 h) is taken over"

FAKE_HOST=0.17.0 FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
{ [[ $rc == 0 ]] && grep -q 'sync the contract to Cezar 0.17.0 (aaaaaaa) — host already runs it' "$T/state.out" \
  && grep -qx 'NEED_HOST=0' "$lock/state.env"; } || { cat "$T/state.out"; fail "pin-only case"; }
rm -rf "$lock"
FAKE_PIN=0.17.0 FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
{ [[ $rc == 0 ]] && grep -q 'the PWA is already pinned to it' "$T/state.out" \
  && grep -qx 'NEED_PR=0' "$lock/state.env"; } || { cat "$T/state.out"; fail "host-only case"; }
rm -rf "$lock"
pass "state.sh: pin-only and host-only titles and needs"

FAKE_LATEST=0.17.0 FAKE_OPEN_PR='#130 https://github.com/acme/cezar-pwa/pull/130' state
{ [[ $rc == 1 && ! -d "$lock" ]] && grep -q 'an open PR already syncs to 0.17.0: #130' "$T/state.out"; } || fail "open PR: exit $rc, want 1"
pass "state.sh: open sync PR → 1"

FAKE_LATEST=0.17.0 FAKE_OPEN_ISSUE=129 state
[[ $rc == 3 && "$(cat "$lock/issue")" == 129 ]] || { cat "$T/state.out"; fail "open issue: exit $rc, want 3 with run.lock/issue"; }
rm -rf "$lock"
pass "state.sh: open issue → 3, issue number in the lock"

FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa FAKE_TAG=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb state
{ [[ $rc == 4 && ! -d "$lock" ]] && grep -q 'tag v0.17.0 is bbbbbbb' "$T/state.out"; } || fail "tag/gitHead mismatch: exit $rc, want 4"
pass "state.sh: tag ≠ gitHead → stopped, lock released"

CEZ_UPGRADE_DRY_RUN=1 FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
[[ $rc == 0 && ! -d "$lock" ]] || fail "dry run took the lock"
pass "state.sh: CEZ_UPGRADE_DRY_RUN writes nothing"

# --- schedule-host.sh ---
host() { set +e; "$dir/schedule-host.sh" >"$T/host.out" 2>&1; rc=$?; set -e; }
FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
echo 131 >"$lock/issue"
: >"$T/calls.log"
host
{ [[ $rc == 0 ]] && grep -qx 'ISSUE=131' "$T/host.out"; } || { cat "$T/host.out"; fail "schedule-host (host+PWA): exit $rc"; }
grep -q "systemd-run --user --unit cezar-upgrade-0-17-0 --collect $dir/upgrade-cezar.sh 0.17.0 0.16.2 131" "$T/calls.log" || fail "transient unit not scheduled"
grep -q 'gh issue comment 131 --repo acme/cezar-pwa' "$T/calls.log" || fail "no scheduled comment on the issue"
pass "schedule-host.sh: behind → unit scheduled, comment, exit 0"

echo 'oops' >"$lock/issue"; host
[[ $rc == 4 ]] || fail "garbage issue number accepted"
echo 131 >"$lock/issue"
FAKE_ISSUE_STATE=CLOSED host
[[ $rc == 4 ]] || fail "closed issue accepted"
pass "schedule-host.sh: refuses a bad or closed issue"

rm -rf "$lock"
FAKE_HOST=0.17.0 FAKE_PIN=0.16.2 FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
echo 132 >"$lock/issue"; : >"$T/calls.log"; host
{ [[ $rc == 0 ]] && ! grep -q systemd-run "$T/calls.log"; } || fail "host current: scheduled anyway (exit $rc)"
rm -rf "$lock"
FAKE_PIN=0.17.0 FAKE_LATEST=0.17.0 FAKE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state
echo 133 >"$lock/issue"; host
[[ $rc == 10 ]] || fail "host-only: exit $rc, want 10"
pass "schedule-host.sh: host current → no unit; no PR needed → 10"

# --- unlock.sh ---
CEZ_RUN_ID=someone-else "$dir/unlock.sh" ok >"$T/unlock.out"
{ [[ -d "$lock" ]] && grep -q 'lock kept' "$T/unlock.out"; } || fail "unlock.sh removed another run's lock"
"$dir/unlock.sh" failed >"$T/unlock.out"
{ [[ ! -d "$lock" ]] && grep -q 'lock released' "$T/unlock.out" && grep -q 'issue: https://github.com/acme/cezar-pwa/issues/133' "$T/unlock.out" \
 ; } || { cat "$T/unlock.out"; fail "unlock.sh did not release its own lock / report"; }
pass "unlock.sh: releases only its own lock, reports the issue"

# --- the workflow graph, with Cezar's own loader when one is cached ---
# CEZAR_WORKFLOWS_DIST points at another install (…/@open-mercato/cezar/dist/workflows).
dist="${CEZAR_WORKFLOWS_DIST:-}"
if [[ -z "$dist" ]]; then
  for d in "$real_home"/.npm/_npx/*/node_modules/@open-mercato/cezar/dist/workflows; do
    [[ -d "$d" ]] && dist="$d"
  done
fi
if [[ -z "$dist" ]] || ! command -v node >/dev/null; then
  echo "skip the workflow graph: needs node and a cezar-cli in the npx cache (npx cezar-cli --help)"
  exit 0
fi
mkdir -p "$T/wf/.ai/cezar/workflows"
cp "$here/cezar-upgrade.yaml" "$T/wf/.ai/cezar/workflows/"
node --input-type=module - "$dist" "$T/wf" <<'EOF' || fail "workflow graph"
const [dist, root] = process.argv.slice(2);
const { loadWorkflows } = await import(`${dist}/load.js`);
const { advance } = await import(`${dist}/graph.js`);
const { workflows, issues } = await loadWorkflows(root);
if (issues.length) { console.error(issues); process.exit(1); }
const g = workflows.find((w) => w.name === 'cezar-upgrade')?.graph;
if (!g) { console.error('cezar-upgrade not loaded'); process.exit(1); }
const routes = [
  ['nothing to do', { state: 'fail', 'state-why': 'true' }, 'nothing', 'success'],
  ['lock held / error', { state: 'fail', 'state-why': 'false', 'state-reuse': 'false' }, 'stopped', 'failed'],
  ['new issue + PR', { state: 'pass', issue: 'filed', host: 'pass', pr: 'opened', 'unlock-ok': 'pass' }, 'done', 'success'],
  ['reuse issue, host only', { state: 'fail', 'state-why': 'false', 'state-reuse': 'true', host: 'fail', 'host-why': 'true', 'unlock-ok': 'pass' }, 'done', 'success'],
  ['PR resumed', { state: 'pass', issue: 'filed', host: 'pass', pr: 'no-pr', resume: 'opened', 'unlock-ok': 'pass' }, 'done', 'success'],
  ['issue stopped', { state: 'pass', issue: 'stopped', 'unlock-failed': 'pass' }, 'stopped', 'failed'],
  ['host error', { state: 'pass', issue: 'filed', host: 'fail', 'host-why': 'false', 'unlock-failed': 'pass' }, 'stopped', 'failed'],
];
for (const [name, ports, end, status] of routes) {
  let cur = 'start', port = 'next';
  for (let i = 0; i < 30; i++) {
    const r = advance(g, cur, port, new Map());
    if (r.kind === 'end') {
      if (r.endNode !== end || r.status !== status) { console.error(`${name}: ended at ${r.endNode}/${r.status}`); process.exit(1); }
      break;
    }
    cur = r.node.id; port = ports[cur];
    if (!port) { console.error(`${name}: no port for ${cur}`); process.exit(1); }
  }
}
const skills = g.nodes.filter((n) => n.skill).map((n) => `${n.id}:${n.skill}`).join(', ');
console.log(`ok   workflow graph: loads, ${routes.length} routes end where expected (${skills})`);
EOF
