# CLAUDE.md — Cezar Mobile (PWA)

A mobile PWA (iPhone first, Android) for watching and steering a **Cezar** instance (`open-mercato/cezar`) running on the operator's host (the host is configuration: `<your-host>` / `$PUBLIC_ORIGIN` in the repo; `OLD_README.md` gives the reference deployment). The app is served from the same origin under `/m/`.

Read before you start:
- `docs/REQUIREMENTS.md` — what we are building, priorities (P0/P1/P2), milestones M0–M5, open questions
- `docs/CEZAR_API.md` — endpoints, SSE, the event protocol, the "needs attention" rule

## Hard rules (do not break without asking)

1. **Same origin or nothing.** Cezar rejects cross-origin writes (403) and has no CORS outside `/health`. Do not propose hosting the PWA on another domain, Vercel and the like, and do not add a CORS proxy.
2. **Only `/api/v1/…`, always in the `/api/v1/p/:projectId/…` form** for project routes. Never the legacy `/api/…`.
3. **Do not mirror DTOs by hand.** The `@open-mercato/cezar-contract` and `cezar-api-client` packages are on npm only as prereleases (`0.10.0-pr931…`, as of 2026-09), older than the server (0.11.x). So `packages/cezar-contract/` in this repo is a **vendored copy** of `packages/contract/src/` and `packages/api-client/src/protocol/ui-events.ts` from the Cezar repo, pinned to the commit recorded in `packages/cezar-contract/UPSTREAM` (script: `npm run sync:contract <sha>`). Do not edit those files by hand. If something is missing, add a local type in `src/api/types.local.ts` with a comment saying where it comes from.
4. **The service worker never touches `/api/**` or SSE streams.** SW scope = `/m/`. Precache the shell only.
5. **The event vocabulary is append-only.** Every `switch` on `event.type` has a `default` branch that does not throw. Ignore unknown fields.
6. **No secrets in the repo, the manifest, localStorage or logs** (the access link, VAPID keys, cookies).
7. **We do not modify Cezar.** Server-side changes = nginx configuration + the `cezar-push` sidecar. If something needs a change in Cezar, write it up as a proposed upstream issue.
8. **The attention rule = a copy of `deriveAttention()`** from Cezar's `packages/web/src/lib/attention.ts`. One implementation in `packages/shared/attention.ts`, used by both the PWA and the sidecar.

## Stack

- Vite 8 + React 19 + TypeScript (strict, ESM) + Tailwind v4 — the same as Cezar's cockpit, so its components and theme tokens can be looked up in `packages/web/src/`
- React Router 7, TanStack Query 5 (server cache), `react-markdown` + `remark-gfm` (agent Markdown, no raw HTML — see `src/features/run/Markdown.tsx`)
- `vite-plugin-pwa` in **`injectManifest`** mode (our own `src/sw.ts` with `push` and `notificationclick` handlers), Workbox precache
- **No list virtualization and no persisted offline snapshot (IndexedDB)** — both are Non-Goals in the PRD. Do not add `virtua` or `idb-keyval`; page long lists, and keep server state in the TanStack Query cache.
- Tests: Vitest + Testing Library; E2E: Playwright with a **WebKit** project (mobile Safari) — Chromium is preinstalled, do not run `playwright install` unless you need to
- Sidecar: Node 20+, Hono, `web-push`, zod

## Repo layout (npm workspaces monorepo)

```
apps/pwa/                 # the PWA
  src/api/                # HTTP + SSE client (fetch wrapper, EventSource manager)
  src/domain/             # pure logic: attention, transcript reducer, formatting
  src/features/runs-list/ # list screen
  src/features/run/       # task details, transcript, actions
  src/features/new-task/
  src/features/settings/
  src/features/auth/      # detecting missing auth, the "Connect to Cezar" screen
  src/sw.ts               # service worker
  src/i18n/en.ts
  public/icons/
apps/push-sidecar/        # cezar-push
packages/shared/          # attention.ts, types shared by the PWA and the sidecar
packages/cezar-contract/  # vendored zod schemas + ui-events from the Cezar repo (UPSTREAM = sha)
deploy/nginx/             # the /m/ and /m/push/ location snippet
deploy/systemd/           # cezar-push.service
scripts/deploy.sh         # build + rsync to the VPS
docs/
```

## Commands

```bash
npm install
npm run dev            # PWA on :5173, proxy /api → CEZAR_URL (see below)
npm run build          # build the PWA into apps/pwa/dist (base: /m/) + the sidecar
npm run typecheck
npm test               # vitest (pwa + sidecar + shared)
npm run test:e2e       # playwright, webkit-iphone project
npm run deploy         # scripts/deploy.sh — needs DEPLOY_HOST in .env.local
```

### Dev against a live Cezar
Vite proxies `/api` → `CEZAR_URL` (e.g. `https://<your-host>`) with a `Cookie` header from `.env.local` (`CEZAR_COOKIE=…`, the file is in `.gitignore`). The proxy must rewrite `Origin` to `CEZAR_URL` (`changeOrigin: true` + a manual `headers.origin`), or the same-origin guard rejects writes. Without `CEZAR_URL` the proxy targets the local mock at `http://127.0.0.1:4321`, never production.
Without VPS access: run `CEZ_DRY_RUN=1 npx cezar-cli` locally (a mock agent) with `CEZAR_URL=http://127.0.0.1:4321`.

## Code conventions

- Code, identifiers and commits in English; UI text in English, only through `src/i18n/en.ts` (the app is single-locale).
- Function components, no classes; domain logic as pure functions in `src/domain/` with table-driven tests.
- Server state only in TanStack Query; SSE updates the cache through `queryClient.setQueryData`, not through a separate store.
- Query keys: `['runs-index']`, `['run', projectId, runId]`, `['history', projectId, runId]`, `['changes', projectId, runId]`, `['health']`.
- Transcript: a reducer `(state, uiEvent) => state` in `src/domain/transcript.ts`, keyed by id (`item.started` → `item.delta` appends → `item.completed` overwrites). Test it on the NDJSON recordings in `test/fixtures/`.
- Every API call goes through `src/api/http.ts`, which recognizes missing auth (401/403, or an HTML response instead of JSON → `AuthRequiredError`), parses `{error}` from the API, and has a timeout.
- CSS: Tailwind, mobile-first, `env(safe-area-inset-*)` on the top and bottom bars, touch targets ≥ 44 px.
- No `dangerouslySetInnerHTML` with agent data.

## iOS specifics — remember

- The installed PWA has **its own cookies**, separate from Safari → sign in inside the app (the "Connect to Cezar" screen).
- Ask for notification permission only from a user gesture and only in standalone mode (iOS 16.4+).
- iOS freezes the app in the background: on `visibilitychange → visible`, close and reopen SSE, refetch data, and resume the transcript from `afterSeq`.
- Do not rely on `beforeinstallprompt` (it does not exist on iOS) — show the "Share → Add to Home Screen" instructions.
- Test on a real device before closing a milestone; the simulator does not receive Web Push.

## Definition of done for every task

1. `npm run typecheck && npm test` pass.
2. New domain logic has tests; a UI change has a component test or an E2E test (WebKit).
3. Works offline in the sense that no network does not give a white screen.
4. Checked in a 390×844 viewport (iPhone 14) in both themes.
5. If it touches Cezar's API — `docs/CEZAR_API.md` is updated.

## When Cezar's API changes

Read `CHANGELOG.md` and `BACKWARD_COMPATIBILITY.md` in the Cezar repo, run `npm run sync:contract <sha>` for the commit matching the version on the VPS (`GET /api/v1/health` → `version`), bump `TESTED_CEZAR_VERSION` in `apps/pwa/src/config/cezar-compat.ts`, and run the contract tests (`test/contract/*.test.ts` — they validate the fixtures against the zod schemas in `packages/cezar-contract`).
