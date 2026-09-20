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
npm install
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

1. `npm run deploy` — builds and rsyncs `apps/pwa/dist` to `/var/www/cezar-mobile`.
2. Include `deploy/nginx/cezar-mobile.conf` in the vhost **before** `location /`,
   and reload nginx.
3. For push (M4), install `deploy/systemd/cezar-push.service` as a user unit.
