# Cezar Mobile (PWA)

Installable phone client (iPhone first, Android second) for a
[Cezar](https://github.com/open-mercato/cezar) instance running at
`https://cezar.ciey.studio`. It answers one question in three seconds: **what
are the agents doing, and is anything waiting for me?**

The app is served from the same origin as Cezar, under `/m/`. That is not a
preference — Cezar rejects cross-origin writes with 403 and ships no CORS, so
any other arrangement simply does not work.

- `docs/REQUIREMENTS.md` — scope, priorities (P0/P1/P2), milestones M0–M5
- `docs/CEZAR_API.md` — endpoints, SSE, event protocol, the "needs attention" rule
- `CLAUDE.md` — the hard rules; read before changing anything

## Status

**M0 (skeleton) is in place**: workspaces, build, manifest, icons, service
worker, nginx snippet and deploy script. The shell renders and installs; it does
not talk to Cezar yet. M1 (live runs list) is the next milestone.

## Layout

```
apps/pwa/                 # the PWA
apps/push-sidecar/        # cezar-push — Web Push sidecar (M4)
packages/shared/          # attention rule + types shared by app and sidecar
packages/cezar-contract/  # vendored zod contract, pinned (empty until synced)
deploy/                   # nginx snippet, systemd unit
scripts/                  # deploy, contract sync, icon generation
```

## Commands

```bash
npm install          # automatic on a fresh clone, see below
npm run dev          # PWA on :5173 under /m/, proxying /api to Cezar
npm run build        # shared -> sidecar -> pwa
npm run typecheck
npm test             # vitest across pwa + sidecar + shared
npm run test:e2e     # playwright, webkit-iphone, against a production build
npm run lint         # oxlint
npm run gen:icons    # regenerate the PWA icon set
npm run deploy       # build + rsync to the VPS (needs DEPLOY_HOST)
npm run sync:contract <sha>
```

`npm run test:e2e` needs WebKit once: `npx playwright install webkit`.

A `SessionStart` hook (`.claude/settings.json` → `scripts/ensure-deps.sh`) installs
`node_modules` the first time Claude Code opens a fresh clone, and reports what it
deliberately does not download. Running `npm install` by hand does the same thing.

## Developing against the live Cezar

Create `.env.local` in the repo root (gitignored — never commit it):

```
CEZAR_URL=https://cezar.ciey.studio
CEZAR_COOKIE=<the session cookie>
DEPLOY_HOST=user@cezar.ciey.studio
```

The dev proxy rewrites `Origin` to the Cezar URL; without that the same-origin
guard rejects every write.

Without VPS access, run a local mock instead: `CEZ_DRY_RUN=1 npx cezar-cli` with
`CEZAR_URL=http://127.0.0.1:4321`.

## Deploying

Merging to `main` ships the shell: `.github/workflows/deploy.yml` runs the CI
gates on that commit and then rsyncs the build to the VPS. It runs the same
`scripts/deploy.sh` a human runs, so there is one deploy path rather than two.

It needs three repository secrets. Until all three exist the job stays green and
posts a warning instead of shipping:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | `user@cezar.ciey.studio` |
| `DEPLOY_SSH_KEY` | Private key whose public half is in the VPS user's `authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan cezar.ciey.studio` — the host key is pinned, never blindly accepted |

Optional repository **variable** `DEPLOY_PATH` overrides the
`/var/www/cezar-mobile` default.

Before the first real deploy, run the workflow manually from the Actions tab
with **dry run** checked: it connects, diffs and writes nothing. `DEPLOY_DRY_RUN=1
npm run deploy` does the same locally.

Two steps remain manual and one-off, both run **on the VPS**:

1. Wire up nginx:

   ```bash
   sudo deploy/nginx/install.sh /etc/nginx/sites-available/cezar.ciey.studio
   ```

   It backs the vhost up, adds the `include`, and only reloads if `nginx -t`
   passes — a config that fails the test is rolled back before nginx sees it.
   The command prints its own rollback line. Re-running only refreshes the
   snippet. If the file holds more than one `location /` block it refuses to
   guess and tells you to add the `include` by hand.

2. For push (M4), install `deploy/systemd/cezar-push.service` as a user unit,
   and uncomment the `/m/push/` block in the snippet **after** filling in the
   cookie check (open question Q1) — it is shipped commented out so the
   sidecar endpoints cannot go live unauthenticated.
