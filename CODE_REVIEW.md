# Code review rules

The review rules for this repository — a React PWA served under `/m/` on the Cezar origin, plus the `cezar-push` sidecar and the nginx/systemd files that deploy them. `om-code-review` (and therefore `om-auto-review-pr`) applies this file automatically; human reviewers use the same list. The hard rules in `CLAUDE.md` are the source; this file turns them into review checks. Protected surfaces are listed in `BACKWARD_COMPATIBILITY.md`.

## Review priorities

In this order — a finding higher up outranks any number below it:

1. **Security and secrets.** No access link, cookie, VAPID key or `.env` content in the repo, the manifest, `localStorage`, IndexedDB, logs, test fixtures or PR text.
2. **Correctness against Cezar.** The app talks to a server it does not own; a wrong assumption about the API ships as a broken phone app nobody can hot-fix.
3. **Contracts.** Anything in `BACKWARD_COMPATIBILITY.md` — especially what an installed PWA or a stored push subscription already depends on.
4. **Offline and iOS behavior.** No white screen without network; the app survives being frozen in the background.
5. **Tests and evidence**, then readability.

## Repo-specific checks

### API layer (`apps/pwa/src/api/`)

- Every request goes through `src/api/http.ts` — no bare `fetch` to `/api` elsewhere. It is what turns a 401/403 or an HTML body into `AuthRequiredError`, parses `{ error }`, and applies the timeout.
- Only `/api/v1/…`, and project routes only as `/api/v1/p/:projectId/…`. A legacy `/api/…` path or a project route without `p/:projectId` is a **blocker**.
- No hand-written DTO that mirrors a Cezar schema. Types come from `packages/cezar-contract` (vendored, never edited by hand — changes only via `npm run sync:contract <sha>`, which also rewrites `UPSTREAM`). A missing type goes in `src/api/types.local.ts` with a comment naming where it comes from upstream.
- A diff that edits `packages/cezar-contract/src/**` without a matching `UPSTREAM` change is a **blocker**.
- No CORS proxy, no alternative origin, no host other than same-origin `/m/` (CLAUDE.md rule 1).
- A change that depends on new API behavior updates `docs/CEZAR_API.md` in the same PR.

### Event handling and live data

- Every `switch` on `event.type` (UI events, workspace events, SSE frames) has a `default` branch that does not throw; unknown fields are ignored. The vocabulary is append-only upstream.
- Server state lives in TanStack Query only. SSE updates the cache via `queryClient.setQueryData`; a parallel store is a finding. Query keys follow `['runs-index']`, `['run', projectId, runId]`, `['history', projectId, runId]`, `['changes', projectId, runId]`, `['health']`.
- Transcript changes go through the reducer in `src/domain/transcript.ts` (id-keyed: `item.started` → `item.delta` appends → `item.completed` replaces).
- On `visibilitychange → visible` the stream is reopened and data refetched; transcript resumes from `afterSeq`. A change that keeps a stale stream open across a background freeze is a bug.

### Service worker (`apps/pwa/src/sw.ts`) and PWA shell

- The SW never intercepts `/api/**` or SSE streams, and its scope stays `/m/`. Precache is the shell only.
- `push` and `notificationclick` handlers tolerate a payload with missing or unknown fields (`PushPayload` fields are all optional).
- Notification permission is requested only from a user gesture, and only in standalone mode.
- No reliance on `beforeinstallprompt` (absent on iOS).

### Attention rule

- "Needs attention" is computed only by `packages/shared/src/attention.ts`, a copy of Cezar's `deriveAttention()`. A second implementation in the PWA or sidecar is a **blocker**; a change to the rule must cite the upstream commit it follows.

### UI (`apps/pwa/src/features/`, `src/pwa/`)

- Function components only. Every user-facing string comes from `src/i18n/en.ts`; a literal string in JSX is a finding.
- No `dangerouslySetInnerHTML`, ever — agent Markdown goes through `features/run/Markdown.tsx` (`react-markdown` without `rehype-raw`, default `urlTransform`, images rendered as alt text). Adding `rehype-raw` or loading agent-supplied image URLs is a **blocker**.
- Mobile-first Tailwind; top and bottom bars respect `env(safe-area-inset-*)`; touch targets ≥ 44 px.
- Works in both themes at 390×844.

### Domain logic (`apps/pwa/src/domain/`, `packages/shared/`)

- Pure functions, no React or I/O imports, with table-driven tests next to them (`*.test.ts`).

### Sidecar (`apps/push-sidecar/`)

- Input validated with zod before use; the subscription store keeps rejecting entries that no longer validate rather than crashing on them.
- Talks to Cezar on loopback only (`CEZAR_URL`, default `http://127.0.0.1:4322`); reachable from outside only through nginx `/m/push/`.
- Outgoing pushes keep a total deadline (`PUSH_TIMEOUT_MS`) and a bounded TTL; a `gone` delivery removes the subscription, a `timeout` does not.
- VAPID keys stay in `STATE_DIR`, never in env files committed to the repo or in logs.

### Deploy (`deploy/`, `scripts/`)

- Every nested nginx `location` repeats the security headers (`add_header` does not inherit once a block sets its own).
- Shell scripts pass shellcheck and keep the rrsync path anchoring documented in `OLD_README.md`.
- `deploy/nginx/rehearse.sh` and `deploy/push/rehearse.sh` must pass; a change to an installer updates its rehearsal.

### Tests

- New domain logic → table-driven unit tests. UI change → a component test (Testing Library) or an E2E spec in `test/e2e/` (WebKit, `webkit-iphone`).
- Playwright API stubs match on `pathname.startsWith('/api/')`, not a `**/api/**` glob (which also swallows `/m/src/api/*.ts` under the dev server).
- No `playwright install` in scripts or docs beyond the WebKit install CI already does.

## Severity

- **Blocker** — secret exposure; breaking a protected surface without its required path; a legacy or non-`p/:projectId` API route; SW touching `/api` or SSE; edited vendored contract; a throwing `default` branch; failing validation gate.
- **Major** — missing tests for new logic; bypassing `http.ts`; a second attention implementation or ad-hoc server-state store; UI text outside i18n; missing offline/visibility handling; `docs/CEZAR_API.md` not updated for an API change.
- **Minor** — naming, comment drift, small readability issues, touch-target or safe-area slips that do not break a flow.

Blockers and majors hold the PR in `changes-requested`. Minors are listed and may be deferred to a follow-up issue.

## Validation gate

The reviewer confirms the gate from `.ai/agentic.config.json` is green: `npm run typecheck`, `npm run lint`, `npm test`, `deploy/push/rehearse.sh`, `npm run build` — plus CI's `e2e (webkit-iphone)` and `infra` jobs.
