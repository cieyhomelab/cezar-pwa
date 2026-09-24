# Cezar Mobile — requirements (PRD)

Version 0.1 · 2026-09-20 · owner: Maciej Kulesza
Purpose of this document: a single source of truth for building the PWA, so Claude Code (and humans) can work from it without asking around.

## 1. Goal and context

Cezar (`open-mercato/cezar`) is a coding-agent orchestrator running on a VPS at `https://<your-host>`, behind nginx with cookie protection. Its cockpit is responsive, but it's a full desktop tool. **Cezar Mobile** is a lightweight, installable PWA for iPhone (priority) and Android, whose main job is: **within 3 seconds of opening it, know what the agents are doing and whether anything needs me** — and when it does, be able to handle it with a thumb.

### Success looks like this
- I open the home-screen icon → I see a task list with live statuses, tasks needing attention at the top.
- I get a push notification when a task moves into `waiting` / `review` / `failed`, even while the app is closed.
- I tap the push → I land in that task's transcript, reply to the agent or approve it.

### Out of scope (deliberately)
Editing workflows, skills, settings, automations; project management and cloning; a full Git/GitHub view; comparing variants; the ⌘K palette. The cockpit is there for that — the PWA has an "Open in the full cockpit" link.

## 2. Architecture (decisions)

| # | Decision | Rationale |
|---|---|---|
| A1 | PWA served from **the same origin**: `https://<your-host>/m/` | Cezar rejects cross-origin writes (guard #426), CORS only covers `/health`; cookie auth works unchanged |
| A2 | Static build (Vite) at `/var/www/cezar-mobile`, nginx `location /m/` **before** `location /` (proxy to Cezar) | Zero changes to Cezar itself, independent deployment |
| A3 | Manifest and Service Worker scope = `/m/` | The SW must not intercept the cockpit or `/api` |
| A4 | Data: directly from Cezar's `/api/v1/…` (REST + SSE) | No need for an intermediate backend for reads |
| A5 | Push: a small **`cezar-push` sidecar** (Node) on the VPS, listens to `http://127.0.0.1:4321/api/v1/workspace/events` (loopback, bypassing the proxy), sends Web Push (VAPID) | Cezar has no Web Push; the sidecar doesn't require forking Cezar |
| A6 | The sidecar exposes `POST/DELETE /m/push/subscription` and `GET /m/push/vapid-public-key` behind the same cookie | Subscriptions are protected the same way as the cockpit |
| A7 | Types and zod schemas **vendored** from the Cezar repo (`packages/contract/src` + `ui-events.ts`) pinned to a commit; zod validation of responses in dev mode | On npm there are only 0.10.0-pr… prereleases, older than the 0.11.x server; vendoring keeps compatibility with what actually runs on the VPS |
| A8 | Stack: Vite + React 19 + TypeScript strict + Tailwind v4 + TanStack Query + React Router + `vite-plugin-pwa` (`injectManifest` strategy) | Same stack as Cezar's cockpit → components move over easily; `injectManifest` because we need our own `push` handler |

Alternative considered and rejected for the MVP: adding a manifest + SW to Cezar's own cockpit (upstream PR). It would give installability, but not a "mobile-first" view or push. Could be proposed upstream later.

### Diagram
```
iPhone (PWA /m/) ──HTTPS+cookie──► nginx ─┬─ /m/          → static PWA files
                                          ├─ /m/push/     → cezar-push :4330 (loopback)
                                          └─ /, /api/...  → Cezar :4321 (loopback)
cezar-push ──SSE (loopback, no auth)──► Cezar /api/v1/workspace/events
cezar-push ──Web Push (VAPID)──────────► Apple/Google push service ──► iPhone
```

## 3. Authentication — requirements and iOS constraints

- **R-AUTH-1** On iOS, an app installed on the home screen has a **separate cookie jar** from Safari. A cookie set in Safari does **not** carry over to the PWA. Sign-in must happen inside the installed app.
- **R-AUTH-2** The PWA detects a missing authorization (a 401/403 response from nginx, or an HTML response instead of JSON) and shows a "Connect to Cezar" screen. The probe is `GET /api/v1/health` (§1a), and the detection lives in one place: `apps/pwa/src/api/http.ts` → `AuthRequiredError`. **No network is not the same as no authorization** — `NetworkError` gets a separate screen, because sending the operator after an access link over a broken tunnel would be a lie.
- **R-AUTH-3** ~~Sign-in screen: a "Paste the access link" field → the app navigates to that link in the current context (not a new tab), nginx sets the cookie and redirects back to `/m/`. This requires the nginx mechanism to support a return parameter (e.g. `?next=/m/`). **To be confirmed with the owner — see §9 Q1.**~~
  **Clarified after inspecting the gateway (2026-09-20, §1a `CEZAR_API.md`).** A return parameter doesn't exist and can't exist — the guard does `return 302 https://$host$uri`, so the whole query string is lost, and **the return target is the link's path**. The "Connect to Cezar" screen therefore takes the pasted link, keeps only its `key` parameter, **swaps the path for `/m/`**, and navigates there in the current context (`location.replace`, never a new tab — an installed PWA has its own cookies). Implementation: `apps/pwa/src/domain/access-link.ts` + `apps/pwa/src/features/auth/`.
- **R-AUTH-3a** ~~If the gateway doesn't handle `?key=` under `/m/` (the guard may live in `location /` rather than `server` — invisible from the client), the app comes back to `/m/` with an unused `key` in the URL. In that case: it **immediately strips `key` from the history entry** (`history.replaceState`) and shows instructions to "open the link in Safari and come back". Returning to the app re-runs the session probe on its own (`visibilitychange`), so the operator doesn't have to tap anything.~~
  **Corrected 2026-09-21.** The advice "open the link in Safari and come back" is **false in the installed app** — it has its own cookies (R-AUTH-1), so a Safari session never reaches it. In the installed PWA there is **no fallback path**: unlocking works under `/m/` or not at all. When `key` comes back unused, the app still strips it from history right away, but it tells the truth: the link is incomplete, or the server has no unlock at `/m/` (`deploy/nginx/install.sh`). The advice "open the link in this browser" is shown only in a regular tab, where the cookie jar is shared.
- **R-AUTH-3b** The key reaches the gateway **byte for byte, exactly as pasted**. nginx compares `$arg_key` against the raw query string, so re-encoding it (`/` → `%2F`, `=` → `%3D`, which `URLSearchParams.set` does) turns a valid base64 key into an invalid one. The first version of S-02 had exactly this bug.
- **R-AUTH-4** Cookie: `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age` ≥ 90 days. A session cookie (without Max-Age) would die when iOS kills the app.
- **R-AUTH-5** The access link never ends up in the manifest, `localStorage`, logs, or the repository.
- **R-AUTH-6** The static `/m/` shell (HTML, JS, icons, manifest) can be public — it contains no data. Everything under `/api` and `/m/push/` requires a cookie. This lets the manifest and icons load correctly on install (Safari fetches the manifest without cookies, as long as there's no `crossorigin="use-credentials"`).

## 4. Functional requirements

Priorities: **P0** = MVP, **P1** = right after MVP, **P2** = later.

### 4.1 Task list (home screen) — P0
- **F-LIST-1** Fetches `GET /api/v1/workspace/runs-index` and shows tasks from all projects.
- **F-LIST-2** Sections in order: **Needs attention** (permission → waiting → review → failed), **Running** (running, including monitoring), **Queued** (queued, with position), **Finished** (done/cancelled, last 24 h, the rest under "Show more"). Archived ones are hidden.
- **F-LIST-3** Row: title (`titleSummary` ?? `title`), project, status (color + icon + text, not color alone), duration / "x min ago", cost (`costUsd`, if capabilities.costMetrics), unread marker, PR/issue number.
- **F-LIST-4** Live updates via `GET /api/v1/workspace/events` (`run`, `run-deleted`) — updates a single row in the cache, without refetching the whole list.
- **F-LIST-5** Pull-to-refresh and automatic refetch when the app comes back to the foreground (`visibilitychange`).
- **F-LIST-6** Connection indicator: green (live), gray (connecting), red (offline / not authorized).
- **F-LIST-7** Filter by project (chips) — remembered locally.

### 4.2 Task details — P0
- **F-RUN-1** Header: title, project, status, workflow, steps (`steps[]` as a progress bar with the current `currentStepId`), runner/model, cost, tokens, branch, link to the PR.
- **F-RUN-2** Transcript: last page from `GET …/runs/:id/history`, older entries loaded on scroll-up (`olderCursor`), virtualized list.
- **F-RUN-3** Live: `GET …/runs/:id/events?afterSeq=<asOfSeq>`; handles `ui-event` (item.started/delta/completed, plan.updated, turn.completed, ask.requested, session.*) and `run` (header).
- **F-RUN-4** Item rendering: agent messages as Markdown; tool calls collapsed to a single line (icon by `toolKind` + `title` + status), expandable on tap (input/output, truncated to ~4 KB with "show all"); reasoning collapsed by default; plan as a checklist pinned at the top.
- **F-RUN-5** Auto-scroll to the bottom only when the user is already at the bottom; otherwise a "↓ new messages" button.
- **F-RUN-6** Entering the details screen triggers `POST …/runs/:id/read`.
- **F-RUN-7** Unknown event types must not crash the view — render a generic entry or skip it.

### 4.3 Actions — P1
- **F-ACT-1** Answering `ask.requested`: a card with questions and options (single/multi-select + "other answer"), sent as a single `POST …/runs/:id/messages`.
- **F-ACT-2** A message field for a running/waiting task (text, optionally a photo from the camera, max 4).
- **F-ACT-3** Contextual buttons: Cancel (running/queued, with confirmation), Accept/Finish (review), Create draft PR (review, has changes), Continue (done/failed), Pin, Archive.
- **F-ACT-4** Every action: loading state, error with the `error` text from the API, optimistic update only where SSE will confirm it anyway.
- **F-ACT-5** Diff preview (`GET …/runs/:id/diff`) — read-only, file by file, line wrapping.

### 4.4 Quick new task — P1
- **F-NEW-1** Form: project, task content, workflow (default `quick-task`), Autonomous toggle, runner (from the available `health.checks`).
- **F-NEW-2** `POST /api/v1/p/:projectId/runs`; on success, navigate to the new task's details.
- **F-NEW-3** Share target (Android; iOS doesn't support it) — sharing a GitHub issue link into the app prefills a task. P2.

### 4.5 Push notifications — P1 (client) + sidecar
- **F-PUSH-1** Settings screen → "Enable notifications" (permission request **only** from a user gesture — an iOS requirement).
- **F-PUSH-2** On iOS the button is visible only when the app is running in standalone mode (`display-mode: standalone`); in Safari we show instructions to "Add to Home Screen".
- **F-PUSH-3** Subscription `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `POST /m/push/subscription`.
- **F-PUSH-4** The sidecar sends a push on a task's **transition** into a state needing attention (rule from `CEZAR_API.md §5`); content: task title, project, reason ("waiting for a reply", "to review", "failed"). No code content or transcript in the payload.
- **F-PUSH-5** Optionally, push on `done` (a settings toggle, off by default).
- **F-PUSH-6** Tapping a notification → `clients.openWindow('/m/run/<projectId>/<runId>')` or focuses the existing window.
- **F-PUSH-7** Deduplication: one push per transition (the sidecar remembers the last status per run); `tag` = runId, so subsequent notifications about the same task replace the previous one.
- **F-PUSH-8** Icon badge (`navigator.setAppBadge`) = count of tasks needing attention; set by the app and by the SW on push.
- **F-PUSH-9** The sidecar removes subscriptions for which the push service returns 404/410.

### 4.6 Installation and offline — P0
- **F-PWA-1** Manifest: `name` "Cezar", `short_name` "Cezar", `start_url` `/m/`, `scope` `/m/`, `display` `standalone`, `theme_color`/`background_color` from the dark theme, 192/512 icons + maskable 512.
- **F-PWA-2** iOS: `apple-touch-icon` 180×180, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` = `black-translucent`, `viewport-fit=cover`, support for `env(safe-area-inset-*)`.
- **F-PWA-3** The SW precaches only the shell (`/m/**`). It **never** caches `/api/**` or SSE streams (network-only, no `respondWith`).
- **F-PWA-4** ~~The last task-list snapshot is kept in IndexedDB; offline → we show the snapshot with a date and an "offline" banner.~~
  **Changed by the PRD (FR-002).** The Socratic round rejected a persistent snapshot: "the phone is almost always online, and data from an hour ago misleads more than its absence would." What's left is just the "offline" banner — no IndexedDB, no snapshot. See `context/foundation/prd.md` § FR-002 and Non-Goals.
- **F-PWA-5** SW update: "New version — refresh" instead of a silent `skipWaiting` mid-session.

### 4.7 Settings — P0/P1
Theme (system/dark/light), notifications (P1), project filter, "Sign out" (clears local data + removes the push subscription), PWA version and Cezar version (`health.version`) with a warning when Cezar is newer than the tested version.

**Implemented in S-12 (2026-09-21), with two differences from this sentence.** There is no "Cezar is newer" warning — the PRD (FR-047) cut it; both versions are shown side by side, next to the version the build was checked against. "Sign out" also ends the session: `POST /m/session/end` on the gateway expires the cookie (`docs/CEZAR_API.md` § 1a). The PWA version is the commit the app was built from. The project filter is on the task list (S-03), not in Settings.

## 5. Non-functional requirements

- **NF-1 Performance:** first render of the list from cache < 1 s on iPhone 12+; JS shell < 200 KB gzip (no shiki; syntax highlighting only in an expanded diff, lazy-loaded).
- **NF-2 SSE resilience:** iOS freezes the app in the background and drops connections. On `visibilitychange → visible`: close the old EventSource, refetch `runs-index` / `history`, open a new one with `afterSeq`. Reconnect backoff 1 s → 30 s with jitter. At most 2 concurrent SSE streams (list + an open task).
- **NF-3 HTTP/2** on nginx (an HTTP/1.1 limit of 6 connections per host would block SSE).
- **NF-4 Accessibility:** statuses conveyed by more than color alone, touch targets ≥ 44 pt, Dynamic Type (rem), AA contrast in both themes.
- **NF-5 Security:** no `innerHTML` with agent data (Markdown via a sanitizing renderer), CSP for `/m/` (`default-src 'self'; connect-src 'self'; img-src 'self' data: blob:`), no external CDNs.
- **NF-6 Compatibility:** iOS 16.4+ (Web Push), current Safari/Chrome on Android. The tested Cezar version is recorded in `src/config/cezar-compat.ts`.
- **NF-7 Privacy:** zero telemetry, zero external services besides the Apple/Google push service.
- **NF-8 UI language:** English (text in a single file, `src/i18n/en.ts`; the app is single-locale — no language switcher).

## 6. `cezar-push` sidecar — specification

- Node 20+, TypeScript, Hono, `web-push`, no database — subscriptions in `~/.cezar-push/subscriptions.json` (atomic writes), status state in memory.
- Listens on `127.0.0.1:4330`; nginx proxies `location /m/push/` → sidecar, behind the same cookie.
- Connects to `http://127.0.0.1:4322/api/v1/workspace/events` (port of the live instance; `CEZAR_URL` in the unit) (Host: `127.0.0.1` — passes the host-guard in loopback mode; also passes if Cezar runs in hosted mode). Reconnects with backoff; after reconnecting, fetches `runs-index` and does **not** send pushes for pre-existing states (only transitions).
- VAPID keys generated once (`cezar-push init`), kept in `~/.cezar-push/vapid.json` (0600); `subject` = the owner's `mailto:` from an env var.
- Endpoints: `GET /m/push/vapid-public-key`, `POST /m/push/subscription`, `DELETE /m/push/subscription`, `POST /m/push/test` (sends a test push), `GET /m/push/health`.
- systemd service `cezar-push.service` (user), logs via journald, no task content in logs.

## 7. nginx configuration (target, to be adapted)

```nginx
# inside the existing server { } for <your-host>, BEFORE location /
location /m/push/ {
    # the same cookie check as for / (insert the existing mechanism)
    proxy_pass http://127.0.0.1:4330;
}
location /m/ {
    alias /var/www/cezar-mobile/;
    try_files $uri $uri/ /m/index.html;
    location = /m/sw.js { add_header Cache-Control "no-cache"; }
    location = /m/index.html { add_header Cache-Control "no-cache"; }
    location /m/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```
`listen 443 ssl http2;` must be enabled.

## 8. Milestone plan

| Milestone | Scope | Completion criterion |
|---|---|---|
| **M0 — Skeleton** | Repo, Vite+React+TS+Tailwind, manifest, icons, SW (shell), nginx `/m/`, deploy script | The home-screen icon on an iPhone opens an empty shell in standalone mode |
| **M1 — Live list** | Auth detection + sign-in screen, `runs-index`, workspace SSE, sections, offline snapshot | On the phone I see tasks and status changes in < 2 s |
| **M2 — Details** | Task history + SSE, item renderer, plan, steps, read | I watch an agent working live; nothing is lost after returning from the background |
| **M3 — Actions** | Ask/message, cancel/finish/PR/continue, diff, new task | I can handle a task in `waiting` and `review` state without a laptop |
| **M4 — Push** | Sidecar, subscription, badge, deep link from a notification | A locked phone gets a push, tapping it opens the right task |
| **M5 — Polish** | Accessibility, themes, E2E tests on WebKit, deployment docs | The checklist in §5 is satisfied |

## 9. Open questions (for the owner)

- **Q1** ~~How exactly does the cookie protection on the VPS work? (nginx `map` on a cookie, `auth_request`, oauth2-proxy, Cloudflare Access…?) Does the access link accept a return parameter (`?next=`)? What `Max-Age` does the cookie have? → affects R-AUTH-3/4.~~
  **RESOLVED 2026-09-20** by reading the live configuration — nginx + a static secret in `?key=`, a 30-day cookie, no return parameter (the return target is the path). Mechanics in `docs/CEZAR_API.md` §1a, consequences in R-AUTH-3/3a.
  ~~**One question remains for the owner:** does the guard `if ($arg_key = …)` sit in the `server` block, or inside `location /`?~~
  **ANSWER 2026-09-21: in `location /`.** The operator pasted the real link into the installed PWA and got rejected for both forms of the link. This is confirmed by a measurement without a key: `/m/` answers 200 without a cookie, so the gateway check doesn't run at the `server` level — and the `?key=` guard sits next to it. `location ^~ /m/` never falls through to `location /`, so the key under `/m/` was simply ignored. **The fix is on the gateway side**, as the PRD predicted ("that is fixed in the perimeter"): the `/m/` snippet includes a copy of the guard (`/etc/nginx/snippets/cezar-mobile-unlock.conf`), which `deploy/nginx/install.sh` cuts out of the vhost on the server — the secret never enters the repo. Reproduced and verified on a local nginx 1.28.3 (the same version as on the VPS): `deploy/nginx/rehearse.sh`. It can't be installed from the repo — the deploy key is `rrsync -wo /var/www`; the installer has to be run on the VPS.
  **Installed and verified 2026-09-21.** The guard doesn't live in the vhost itself, but in `/etc/nginx/snippets/cezar-gate.conf`, included in `location /` (the cookie check reads a `map` from `conf.d/cezar-gate.conf`); the extractor therefore searches the vhost and the files it includes. On the live gateway: `/m/?key=<real>` → 302 to `/m/` + `Set-Cookie`, a wrong key → a shell without a cookie, `/` and `/api/v1/health` without a cookie → 403, a session from `/m/` opens `/api/v1/health`. Pasting the real link into the app (WebKit, live host) lands on the screen behind the gate and survives a reload.
- **Q2** Is nginx installed via `cezar server-install` (in which case the vhost is managed by Cezar and may be overwritten on `server-install --reinstall`), or via an external proxy (`--external-proxy`)?
  **ANSWER 2026-09-21:** the vhost is generated by `cezar server-install` ("Managed by cezar server-install — do not edit by hand") and rewritten on reinstall. The gate survives this thanks to `cezar-gate-ensure.path` + `.timer`, which restore **only** `include …/cezar-gate.conf`. **Our `include …/cezar-mobile.conf` is not restored** — after a Cezar reinstall, `/m/` falls into `location /` and gets a 403, so the "Connect to Cezar" screen disappears. Automated in #29: `cezar-mobile-nginx-ensure.path` + `.timer` run `install.sh --ensure`, which restores our include (README §Deploying, step 3).
- **Q3** How many projects are registered, and is Cezar running on a stable, nightly, or develop build? (affects how fast the API changes)
- **Q4** Is Android an equal target, or does it just need to "work"?
- **Q5** Push on `done` too, or only when a reaction is actually needed?
