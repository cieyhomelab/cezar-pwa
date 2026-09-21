# Cezar Mobile (PWA)

An installable phone client for a
[Cezar](https://github.com/open-mercato/cezar) instance running at
`https://cezar.ciey.studio`. It answers one question in three seconds: **what
are the agents doing, and is anything waiting for me?** Then it lets the operator
act on the answer.

The app is served from the same origin as Cezar, under `/m/`. That is not a
preference: Cezar rejects cross-origin writes with 403 and ships no CORS, so
no other arrangement works.

- `context/foundation/roadmap.md`: slices, their status and what is left on the host
- `context/foundation/prd.md`: the product requirements
- `docs/CEZAR_API.md`: endpoints, SSE, event protocol, the "needs attention" rule
- `CLAUDE.md`: the hard rules. Read it before changing anything.

## How it fits together

```mermaid
flowchart LR
  phone["Phone<br/>installed PWA + service worker"]

  subgraph vps["VPS — cezar.ciey.studio"]
    nginx["nginx"]
    shell["/var/www/cezar-mobile<br/>static shell"]
    cezar["Cezar<br/>127.0.0.1:4322"]
    push["cezar-push sidecar<br/>127.0.0.1:4330"]
  end

  pushsvc["Browser push service<br/>(APNs / FCM)"]

  phone -- "/m/ (public, unlocks the session)" --> nginx
  phone -- "/api/v1/… + SSE (gated)" --> nginx
  phone -- "/m/push/ (gated)" --> nginx
  nginx --> shell
  nginx --> cezar
  nginx --> push
  push -- "workspace events over loopback" --> cezar
  push -- "Web Push (VAPID)" --> pushsvc
  pushsvc --> phone
```

The shell at `/m/` sits outside Cezar's cookie gate, so the app can load and
explain itself before it has a session. Everything that carries data (the API,
the event streams and `/m/push/`) sits behind the gate. The service worker
caches only the shell and never touches `/api/**` or the streams.

When a task starts needing the operator, this happens:

```mermaid
sequenceDiagram
  participant C as Cezar
  participant S as cezar-push
  participant P as Push service
  participant W as Service worker
  participant A as App

  S->>C: GET /api/v1/workspace/runs-index (silent baseline)
  S->>C: GET /api/v1/workspace/events (SSE)
  C-->>S: run frame: task enters waiting / review / failed
  S->>P: Web Push, Topic = task, payload = title, project, reason
  P-->>W: push
  W->>W: show notification (tag = task, words from pl.ts)
  W->>A: tap opens /m/p/:projectId/runs/:runId
```

The sidecar pushes on the *transition*, using the cockpit's own rule. Each
reconnect re-seeds a silent baseline, so work that was already waiting never
rings twice. No code and no transcript content leave the server.

## Layout

```
apps/pwa/                 # the PWA
  src/api/                # the one HTTP door, live streams, push client
  src/domain/             # pure logic: attention, transcript, diff, actions
  src/features/           # auth, runs-list, run, diff, settings
  src/sw.ts               # service worker: precache, push, notificationclick
apps/push-sidecar/        # cezar-push, the Web Push sidecar (Hono + web-push)
packages/shared/          # attention rule + types shared by app and sidecar
packages/cezar-contract/  # vendored zod contract, pinned at Cezar v0.11.0
deploy/nginx/             # /m/ snippet, installer, rehearsal
deploy/push/              # sidecar installer
deploy/systemd/           # cezar-push user unit
scripts/                  # deploy, contract sync, icon generation
context/                  # PRD, roadmap and one folder per change
```

## Commands

```bash
npm install          # automatic on a fresh clone, see below
npm run dev          # PWA on :5173 under /m/, proxying /api to Cezar
npm run build        # shared -> sidecar -> pwa
npm run typecheck
npm test             # vitest across pwa + sidecar + shared
npm run test:e2e     # playwright on WebKit, against a production build
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
| `DEPLOY_HOST` | `ubuntu@cezar.ciey.studio` — Cezar and the shell live on the same box |
| `DEPLOY_SSH_KEY` | Private half of a dedicated passphrase-less ed25519 pair; the public half sits in the VPS user's `authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan cezar.ciey.studio` — the host key is pinned, never blindly accepted |

The deploy key is not a login. Its `authorized_keys` entry pins it to a forced
command, so a leaked secret writes files and nothing else — no shell, no reading
back, no reaching Cezar:

```
command="/usr/bin/rrsync -wo /var/www",restrict ssh-ed25519 AAAA… github-actions-deploy
```

Regenerate it on the VPS with `ssh-keygen -t ed25519 -N '' -f ~/.ssh/cezar_pwa_deploy`,
append that line, and push the private half with `gh secret set DEPLOY_SSH_KEY < ~/.ssh/cezar_pwa_deploy`.

Because rrsync anchors every client path inside its restricted directory, CI
sets the repository **variable** `DEPLOY_PATH` to `/cezar-mobile` — relative to
`/var/www`, it lands on `/var/www/cezar-mobile`. Passing the absolute path there
would sync into `/var/www/var/www/cezar-mobile` instead. A human deploying with
their own (unrestricted) key leaves `DEPLOY_PATH` unset and gets the
`/var/www/cezar-mobile` default; do not copy the CI value into `.env.local`.

Before the first real deploy, run the workflow manually from the Actions tab
with **dry run** checked: it connects, diffs and writes nothing. `DEPLOY_DRY_RUN=1
npm run deploy` does the same locally.

Two steps remain manual and one-off, both run **on the VPS**:

1. Wire up nginx:

   ```bash
   sudo deploy/nginx/install.sh /etc/nginx/sites-available/cezar-cezar-ciey-studio
   ```

   It backs the vhost up, adds the `include`, and only reloads if `nginx -t`
   passes — a config that fails the test is rolled back before nginx sees it.
   The command prints its own rollback line. Re-running only refreshes the
   snippet. If the file holds more than one `location /` block it refuses to
   guess and tells you to add the `include` by hand.

   It also copies the vhost's `if ($arg_key = …)` unlock guard into
   `/etc/nginx/snippets/cezar-mobile-unlock.conf` (mode 600, never printed),
   which the `/m/` location includes. Without that copy the installed app
   cannot unlock itself: the guard lives in `location /`, which never sees
   `/m/`. **Re-run the installer after rotating the access key**, or `/m/`
   keeps accepting the old one. If it cannot find exactly one guard it says
   so and leaves the file out — the shell still serves, it just cannot unlock.
   `deploy/nginx/rehearse.sh` checks all of this against a scratch nginx,
   no VPS needed.

2. Install the push sidecar, as the user Cezar runs as (not root):

   ```bash
   deploy/push/install.sh
   ```

   It builds the one-file bundle into `~/cezar-push` and creates the VAPID key
   pair once, in `~/.cezar-push`. It then installs and starts the `cezar-push`
   user unit, listening on `127.0.0.1:4330`. Re-running it upgrades the bundle
   and keeps the keys and subscriptions. Run `sudo loginctl enable-linger $USER` once so
   the unit survives logout. The `/m/push/` route comes from step 1 and reuses
   the gate's `$cezar_gate_ok`, so it holds no secret. On a host without the
   gate, `nginx -t` fails and the installer rolls back.

**After any `cezar server-install`, re-run step 1.** Cezar's installer rewrites
the vhost, and `/m/` falls behind the gate until the include is back.
