# Cezar API — cheat sheet for the PWA

Source: `open-mercato/cezar` @ tag `v0.11.1` (`4763447`) — the version the instance on the VPS reports (`GET /api/v1/health`, 2026-09-24; previously `v0.11.0` / `67fc941`). Between `v0.11.0` and `v0.11.1` the contract changed only additively (automation events for PR reviews + the `reviewers` filter, `projects[].unregistered`, allowed spellings of image extensions in attachment names); places described below as "@ `v0.11.0`" did not change in `v0.11.1` unless noted otherwise. The contract is vendored from the same commit (`packages/cezar-contract/UPSTREAM`).
Source-of-truth files (check them on every Cezar update):

- `packages/contract/src/*.ts` — zod schemas for every request/response (`runs.ts`, `events.ts`, `health.ts`, `workspace.ts`, `projects.ts`)
- `packages/api-client/src/protocol/ui-events.ts` — the agent event vocabulary (SSE, `ui-event`)
- `packages/cezar/src/server/server.ts` — route definitions, guards, SSE
- `packages/web/src/lib/attention.ts` — the "needs attention" logic (we copy it 1:1)
- `BACKWARD_COMPATIBILITY.md` — what is frozen and what may change

## 1. General rules

- We use **only** the versioned `/api/v1/…` surface. The old `/api/…` routes are frozen for bookmarklets — we do not build on them.
- Every project route exists in two variants: `/api/v1/<path>` (the project Cezar started in) and `/api/v1/p/:projectId/<path>`. **The PWA always uses the `projectId` variant**, because it shows tasks from all projects.
- Cezar **has no authentication of its own** — the perimeter is the reverse proxy (for us: nginx + a cookie). `createCezarClient({ token })` has a Bearer option, but the server does not require it today. Gate details: section 1a.
- **Same-origin guard (#426):** every `POST/PUT/PATCH/DELETE` with an `Origin` header different from `Host` → `403`; `Sec-Fetch-Site: cross-site` → `403`. CORS is open only for `GET /api/v1/health`. ⇒ **The PWA must be served from the same origin** (`https://<your-host>`, i.e. `$PUBLIC_ORIGIN`), otherwise writes and reads will not work.
- Errors have the shape `{ "error": string }` + an HTTP code (400 validation, 404 missing, 409 state conflict).

## 1a. The nginx gate — verified on the live instance (2026-09-20)

Examined directly on the VPS. Replaces guesswork; if the nginx configuration changes, this section needs re-checking.

**The session cookie**

- `Max-Age=2592000` (30 days), `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`.
- **It is not sliding.** `Set-Cookie` is sent **only** on a `?key=` hit; a plain request with a valid cookie returns 200 without `Set-Cookie`. The clock ticks from the moment the link was clicked, regardless of how much the app is used.
- The cookie value is a **static shared secret, identical to the `key` parameter**. There is no per-user session and no server-side store; revocation = editing both files + reloading nginx.
- `HttpOnly` ⇒ **JS will never see this cookie.** The PWA cannot read it, check its expiry date or renew it. A proactive "you have 3 days left" is impossible — the only signal is a 403 in flight.

**No session = a bare refusal**

- `403`, `Content-Type: text/html`, 148 bytes of static HTML. No `Location`, no `WWW-Authenticate`, no CORS, no `Cache-Control`.
- Identical for `GET`, `POST`, XHR, SSE and deep links. A stale cookie gives exactly the same as no cookie.
- **There is no redirect and no login page.** "Connect to Cezar" cannot be a login — the app behind the gate has no authorization at all (`http://127.0.0.1:4322/` returns 200 without credentials). The only possible shape is: detect the 403 → show the unlock-again screen.
- A cheap session-state probe: `GET /api/v1/health` — with the cookie, JSON with the version; without it, 403.

**The unlock link does not accept a return parameter**

- The guard has the shape `if ($arg_key = "…") { add_header Set-Cookie …; return 302 https://$host$uri; }`. `$uri` is the path alone — **the whole query string is lost**.
- The return target is therefore encoded **in the path** of the unlock link, not in a parameter.
- Two pitfalls: `$uri` is decoded (`/p/x/run%20one?key=…` → `Location: …/run one`, a header with a space), and state kept in query params cannot be carried over.
- The PWA cannot build such a link anyway — it would contain the secret, and the secret never goes into our storage (PRD guardrail).

**How the PWA uses this (S-02, shipped 2026-09-20)**

- Session probe: `GET /api/v1/health` through `apps/pwa/src/api/http.ts`. `401/403` **or** a non-JSON response → `AuthRequiredError` → the "Connect to Cezar" screen. A network error/timeout → `NetworkError` → a separate "can't connect" screen; the two states never mix.
- Probe again on every `visibilitychange → visible` — the cookie cannot be read, so the only answer to "is the session still alive" is a request, and iOS freezes the app for hours.
- Unlocking: pasted link → only the `key` is kept, **raw, byte for byte** → **path replaced with `/m/`** → `location.replace`. The path is the only carrier of the return target (`return 302 https://$host$uri`), so it is the only shape that can work. Rawness is required: `$arg_key = "…"` compares the undecoded query string, so `%2F` instead of `/` is a different key. The secret goes nowhere beyond that one request; if we come back with an unused `key` in the URL, it is removed from the history entry immediately.
- **Where the gate really is (read on the host 2026-09-21):** `location / { include /etc/nginx/snippets/cezar-gate.conf; proxy_pass … }`. The gate snippet holds the `?key=` guard and `if ($cezar_gate_ok = 0) { return 403 …; }`; the variable comes from a `map` in `/etc/nginx/conf.d/cezar-gate.conf`. The cookie is named `cezar_gate`. `cezar server-install` rewrites the vhost; `cezar-gate-ensure.path`/`.timer` restore only the gate include.
- **The guard sits in `location /` — confirmed 2026-09-21** (a real link in the installed PWA was ignored; `/m/` without a cookie returns 200, so the gate check does not work at the `server` level). `location ^~ /m/` never sees it, which is why the `/m/` snippet includes a copy of the guard — see below.

**Deployment consequences — for `deploy/nginx/`**

- **`/m/` needs a copy of the `?key=` guard** (and only that — not the cookie check). The snippet has `include /etc/nginx/snippets/cezar-mobile-unlock*.conf;`, and `deploy/nginx/install.sh` cuts the `if ($arg_key = …) { … }` block out of the vhost into that file (mode 600, never printed; the secret never reaches the repo). A glob — a missing file does not break `nginx -t`, it only disables unlocking. After changing the key, **run the installer again**. Verification without the VPS: `deploy/nginx/rehearse.sh`.
- **Sign-out (S-12, FR-006) is done by the gate, because nobody else can.** The cookie is `HttpOnly`, so JS cannot remove it, and Cezar has no sign-out (it has no sign-in either). The `/m/` snippet includes `/etc/nginx/snippets/cezar-mobile-signout*.conf`, which `install.sh` generates with `deploy/nginx/signout-from-unlock.sh` from the `Set-Cookie` of the extracted guard: it takes **only the name, `Path` and `Secure`** (never the value — expiring a cookie does not need the value). Result: `location = /m/session/end` — a `POST` with an `Origin` header equal to `$scheme://$http_host` → **204** + `Set-Cookie: cezar_gate=; Path=/; Max-Age=0; …`. `GET` → 405 (neither a prefetch nor a pasted link signs you out), a different or missing `Origin` → 403. On a host without that file the `POST` hits the static shell → 405, and the app says the session stayed. It signs out **only this cookie jar** — the installed PWA on iOS has its own, so Safari and other devices stay signed in; the gate secret does not change (revoking access = changing the key). Verification: `deploy/nginx/rehearse.sh`.
- **`location /m/` must sit OUTSIDE the `?key=` guard.** The installed PWA on iOS has cookies separate from Safari, so a launch from the icon goes out without a cookie. If the shell is behind the gate, the user gets the 148-byte 403 HTML **at the app shell's address** and has nothing to render — the "Connect to Cezar" screen never appears. Only `/api/**` stays protected.
- **The service worker must explicitly reject `!response.ok` before writing to the cache.** The 403 response has no `Cache-Control`, is `text/html` and arrives at the same URL as the shell — the SW can persist the error page as the app shell. A correct 200 from the cockpit carries `Cache-Control: no-cache`.

## 2. Reads — what the PWA fetches

| Purpose | Method and path | Response (schema) |
|---|---|---|
| Version, projects, capabilities | `GET /api/v1/health` | `healthResponseSchema`: `version`, `projects[{id,name}]`, `bootProject`, `capabilities{…}`, `checks[]` |
| Task list from **all** projects | `GET /api/v1/workspace/runs-index` | `runsIndexResponseSchema`: `runs: RunIndexEntry[]` (newest first, max 200/project), `truncated[]` |
| Project list | `GET /api/v1/projects` | the project registry |
| Task details | `GET /api/v1/p/:projectId/runs/:id` | `ApiRun` (= `RunRecord` + API fields) |
| Transcript – a history page (from the end) | `GET /api/v1/p/:projectId/runs/:id/history?cursor=` | `RunHistoryPage`: `events[]` (raw lines of the last 100 *items*, not 100 lines), `itemCount`, `olderCursor`, `newerCursor`, `liveCursor`, `asOfSeq`, `hasOlder` |
| Transcript – current context | `GET /api/v1/p/:projectId/runs/:id/history-context` | `RunHistoryContext`: `contextEvents[]` (the newest `plan.updated`, turn boundaries, open items — wherever they sit in the file), `asOfSeq` |
| Task diff (text) | `GET /api/v1/p/:projectId/runs/:id/diff` | a single `text/plain` blob; for a task without a worktree **200** with the sentence "(no worktree — …)" instead of a diff — the PWA does not use it |
| Changed files with patches (S-09) | `GET /api/v1/p/:projectId/runs/:id/changes` | `ChangesPayload`: `files[]` (`ChangedFile`: `path`, `oldPath?`, `status`, `adds`, `dels`, `binary`, `image?`, `patch`), `stat`, `repointedHead?`; missing directory/git error → **409** `{ error }` |
| Task variants (S-21) | `GET /api/v1/p/:projectId/groups/:groupId` | `GroupResponse`: `{ groupId, runs[] }`, `runs` sorted by letter; a row (`GroupVariant`): `id, variant, title, status, archived, tokensUsed, inputTokens?, outputTokens?, costUsd?, diffStat, handoffExcerpt`. **`diffStat` is `git diff --stat` text**, not numbers from the record; `''` when the worktree does not exist. No runs with this `groupId` → **404** |
| Project automations (S-20) | `GET /api/v1/p/:projectId/automations` | `AutomationsResponse`: `available`, `reason?` (forge availability — not a 5xx), `scheduler{state,nextDue?}`, `timeZone`, `stats`, `automations[]` (`AutomationListEntry`: the definition + `enabled`, `kind` `schedule\|github`, `schedule?`/`events?`, `state?`, `latestLog?`, `counts`, `nextRunAt?` — absent when paused, `lastRun?{runId,status,ts}`, `runs7d`). The whole family answers **409** when `capabilities.automations` is off |
| Automation log (S-20) | `GET /api/v1/p/:projectId/automation-log` | `AutomationLogResponse`: `records[]` (newest first, max 100; `seq, ts, automationId, result, reason?, runId?, githubNumber?, githubTitle?`), `runs{[runId]: {title,status,costUsd?,children[]}}` |
| PR merge state (S-19) | `GET /api/v1/p/:projectId/github/prs/:number/merge-state[?refresh=1]` | `GithubPrMergeStateResponse`, always **200**: `{ available: false, reason }` (no forge / `gh`) or `{ available: true, mergeState }` (`githubPrMergeStateSchema`: `number, title, url, state` `open\|closed\|merged`, `isDraft, headRef, baseRef, headSha, mergeable, reviewDecision, checks[{name,state,required,url?}], methods[], defaultMethod, eligibility` `ready\|blocked\|pending\|unauthorized\|terminal\|unknown`, `blockers[{code,message}]`, `canMerge, canOverride`). The server caches it for 15 s; `refresh=1` asks GitHub afresh. The PR number is relative to the **project's** repo |
| PR check glyphs | `GET /api/v1/p/:projectId/github/checks?prs=1,2` | `GithubChecksData`: `{ available, checks{[number]: glyph} }` — one glyph per PR; the PWA does not use it (the merge state carries the full list of checks) |
| Task commits | `GET /api/v1/p/:projectId/runs/:id/commits` | `{ commits: RunCommit[] }` |
| Handoff notes | `GET /api/v1/p/:projectId/runs/:id/handoff` | Markdown |
| An image from the transcript and a queued attachment (#65) | `GET /api/v1/p/:projectId/runs/:id/images/:file` | image (or file) bytes; `:file` is the bare file name, e.g. `2.png`. The non-project variant `/api/v1/runs/:id/images/:file`, which the server writes into the history and into `queuedMessages[].images`, returns **404** on the live host (0.11.0) |
| Workflows (for the composer) | `GET /api/v1/p/:projectId/workflows` | `workflowsResponseSchema`: `workflows[]` (`name`, `description?`, `steps[]`, `source`), `issues[]` (files that could not be loaded) |
| Project agent settings | `GET /api/v1/p/:projectId/config` | `configResponseSchema`: `defaultRunner`, `defaultModels{claude?,codex?,…}`, `modelsLocked`, … |
| Runner models | `GET /api/v1/models?runner=claude\|codex\|opencode` | `runnerModelCatalogResponseSchema`: `models[{id,label,description}]`, `source` (`live\|cache\|unavailable`), `stale`. A **workspace** route — `GET /api/v1/p/:projectId/models` returns **404** (checked on `0.11.0`, 2026-09-24). `pi` has no catalog (400) |
| Agent accounts | `GET /api/v1/workspace/agent-profiles` | `agentProfilesResponseSchema`: `profiles[]` (`id`, `provider`, `label`), `selections`, `defaults`; on this host (`CEZ_REMOTE`) `profiles: []` — the sidecar's limits collector reads it on loopback for the accounts to poll (§ 6) |

### RunStatus
`queued | running | waiting | review | done | failed | cancelled`
plus `activity: 'monitoring'` (a substate of `running` — the agent is waiting on its own background work, it does **not** need attention) and `autoResumeAt` (a task `failed` on a provider limit that will resume by itself → treat as "scheduled", not as an error).

### The task list in the PWA (S-03) — how we read `runs-index`
- A single `GET /api/v1/workspace/runs-index` request (a workspace route — there is no `/p/:projectId/` variant), key `['runs-index']`. Project names come from `GET /api/v1/health` → `projects[]` (already cached after the session probe).
- The response is **not** validated with a zod schema at runtime: the contract's enums are closed, and the vocabulary grows. We only check that `runs` is an array — otherwise an error, never an empty list ("nothing is waiting" would be untrue). The schemas validate the fixtures in tests (`apps/pwa/test/contract/`).
- PRD sections (FR-008): Needs attention / In progress / Queued (+ scheduled resumes) / Finished; archived ones hidden. Order within a section = `sortRuns` from `web/src/lib/task-groups.ts`. The queue number is counted across the whole workspace (the `maxParallel` semaphore is shared by projects).
- Refreshing: on return to the foreground (`refetchOnWindowFocus: 'always'`), with a button and a pull gesture; live from the workspace stream (S-04, § 3a), polling every 30 s when the stream is down and every 5 min when it is up. 401/403 → probe `health` again → the "Connect to Cezar" screen.
- `runs-index` **does not carry** `pinned` or `groupId` — so the PWA list has no "Pinned" section and no variant collapsing. Variants show up only on the task screen (S-21): from the record's `groupId`.

### Key `RunIndexEntry` fields (list)
`projectId, id, title, titleSummary, status, activity, createdAt, startedAt, finishedAt, seenAt, archived, autoResumeAt, workflow, branch, pullRequestUrl, prNumber, issueNumber, costUsd, peakRssBytes, usage{cpu,rss…}`

### Additional `RunRecord` fields (details)
`task, steps[{id,name,kind:'agent'|'check',status,…}], currentStepId, diffStat, model, runner, autonomous, queuedMessages[], tokensUsed, inputTokens, outputTokens, error, worktreePath, groupId, variant, pinned`

### The task screen in the PWA (S-05) — how we read the record and the transcript
- Three reads in parallel: the record (`['run', projectId, runId]`), the newest history page without a cursor (`['history', projectId, runId]`) and the context (`['history', projectId, runId, 'context']`). Since S-06 the screen is live from the task stream (§ 3b); when the stream is down — refreshing like the list before S-04: on return to the foreground, every 30 s while visible, with a button; no silent retries. A response older than 60 s is dimmed while refreshing (guardrail: stale state never pretends to be current).
- **The history page is the raw file, not the v2 protocol alone.** v2 events (`item.*`, `turn.*`, `plan.updated`) lie interleaved with their v1 twins (`text`, `tool-call`, `tool-result`) and with v1-only lines (`user-message` — operator messages exist **only** in v1 — `note`, `lifecycle`, `check-output`, `image`, a failed `step-end`). Measured on a live page: every tool call is in the file twice. Hence `apps/pwa/src/domain/transcript.ts` is a port of `reduceThread()` from `web/src/routes/task-thread/thread-state.ts` together with the deduplication rules (within a v2 turn, v2 wins for tools; v1 prose disappears only when the v2 message of the same turn has the same text).
- `item.delta` **does not occur** in the history (deltas are ephemeral, live stream only). The reducer handles them anyway — S-06 adds events from the stream (§ 3b) to the same fold.
- Scrolling (FR-019, S-06): the screen follows new content only when the reader is ≤ 96 px from the end; further up it stays in place and shows a "New messages" button. "At the end" is computed synchronously against the content height from before the change — WebKit sends `scroll` only with the next frame.
- An unknown `type`, an `item.*` with an unknown `kind` or without an `id` — skipped, nothing throws (rule 5; the PRD allows "render generically or skip").
- **The plan pinned above the transcript** is assembled from context ∪ page (the equivalent of `currentEvents` in the cockpit), because the newest `plan.updated` may lie before the page's first line. The transcript content — from the page only. A context error does not break the screen (the plan then comes from the page only).
- **Older pages (FR-049, #64):** when `hasOlder`, scrolling to the top of the transcript (`IntersectionObserver`, 300 px margin; the same "Show older entries" button manually) fetches `GET …/history?cursor=<olderCursor>` and adds the page **before** the one held, in the same `['history', projectId, runId]` entry (`prependOlder()` in `src/domain/live-transcript.ts`). We fold the raw lines of both pages merged by `seq` (`mergeBySeq`), not two folded pieces — a turn crosses the page boundary, and v1/v2 deduplication works within a turn. The server repeats the turn-opening line (`user-message`/`turn.started`) before the page's first item, however far back it lies — merging by `seq` collapses it. Cursor semantics from `dist/runs/event-history.js` @ `0.11.1`: `olderCursor` = base64url `{ v, kind: 'page', direction: 'older', fileSize, boundarySeq }`, the older page is the last 100 items with `seq < boundarySeq`; a file shorter than `fileSize` → **409** (the PWA treats it like any error — retry or the cockpit). The cursor is opaque to us.
  - The reader keeps their place (`useKeepPlace`): just before writing to the cache we note the first visible entries (`data-entry-key` — the entry's key, not the turn's, because a turn opened mid-page gets its earlier entries and may change id), after rendering we scroll by the offset. We recognise content **above** by `pageReach()` (the seq of the page's **second** line — the first is sometimes the repeated opening line, shared by pages of one long turn) moving back; then `useFollowBottom` does not show "New messages". When it moves forward (a refresh without a bookmark), it is ordinary new content — a reader at the end follows it.
  - Refreshing the newest page (every 30 s without the stream, after a write) does not lose what was read backwards: `carryOver` keeps the earlier lines and the backwards cursor, as long as the fresh page overlaps the held one (its `pageReach()` ≤ the held page's `asOfSeq`; the held page reaches further when its `pageReach()` is smaller — the comparison is past the opening line, because in one long turn both pages start with the same one). Without a bookmark the fresh page replaces everything, as before: the lines in between are on neither page, and showing a gap as continuity would be a lie.
  - Page error: in place of the button, an alert "Could not load older entries." with "Retry" and a link to the cockpit; the transcript stays. No automatic retries. `hasOlder` without `olderCursor` → the old link to the cockpit. At the start of the file (`hasOlder: false`) the top says "The transcript starts here.", with the task prompt below it.
  - Fixtures: `transcript-long.ndjson` (synthetic, 1099 lines, the first turn longer than a page) and `history-pages.long.json` — pages cut by Cezar's `0.11.1` reader (`scripts/record-history-pages.mjs`).
- **Images from the transcript (#65):** a v1 `image` line carries a `url` in the non-project form `/api/v1/runs/:id/images/:file` (404 on the live host) and a `name` given by the agent. From the URL we take **only the file name** (`^[A-Za-z0-9._-]+$`, not dots alone; `attachmentFileName()` in `apps/pwa/src/domain/run-images.ts`), never the path, and read it from `…/p/:projectId/runs/:id/images/:file` (`runImageUrl()`). The thumbnail opens full-screen; no safe name or a load error → the existing line with the name. The same rule for `queuedMessages[].images` (images by `isImageAttachmentName`, other files by name only). CSP unchanged (`img-src 'self'`). Images in the agent's Markdown are still not loaded — we render the alt text (no requests to third parties).
- **Read (FR-020):** `POST …/runs/:id/read` sent once, only when `isUnread(run)`. The response is the whole record, but **only** `seenAt` goes into the cache (`['run', …]` and the row in `['runs-index']`) — just like `useMarkRunSeen` in the cockpit (a pre-flight snapshot would revert fields that changed in the meantime).
- **All read (#67):** the list sends `POST …/runs/read-all` once per project that has an unread row **on screen** (`readAllPlan()` in `apps/pwa/src/domain/read-all.ts` — the FR-013 project filter decides who the call goes to), in parallel, after a single confirmation. Results are independent: a project that refused is named with the reason and keeps its markers. Nothing goes into the cache optimistically — after the attempt we invalidate `['runs-index']` and the `['run']` prefix. "Archive finished" (`…/runs/archive-finished`) deliberately left out: it also archives `failed`, removes pins and scheduled resumes.
- Screen path: `/m/p/:projectId/runs/:runId` — the same one a notification opens (S-10, `apps/pwa/src/pwa/push-message.ts`). The router has `basename="/m/"` **with the slash**: from `/m` a link to the list leads under `/m`, outside the service worker's scope and outside `location ^~ /m/` in nginx.

### The task diff in the PWA (S-09) — how we read `/changes`
- Screen `/m/p/:projectId/runs/:runId/diff`, opened by the "Changes" row in the task header (numbers from `run.diffStat` when the record has them — it appears only after the first finished turn, so the row is always there, at worst with "Show changes"). Key `['changes', projectId, runId]`.
- **`/changes`, not `/diff`.** `/changes` is the structured counterpart with the same base as the cockpit's Changes tab (`resolveTaskDiffBase`: the merge-base with the freshest base ref; for a worktree repointed to another branch — only what the task changed there, plus `repointedHead`). `/diff` answers with text and for a task without a worktree returns **200** with a message — the phone would take it for a diff. Measured live: a task with a repointed worktree answers `{ files: [], stat: 0, repointedHead: { headBranch: 'HEAD', taskBranch: 'cez/…' } }` (`test/fixtures/changes-repointed.live-0.11.0.json`).
- `patch` is one file's `git diff` section (`diff --git` + headers + hunks), truncated by the server after 200,000 characters with a trailing `… (patch truncated)`. The parser (`apps/pwa/src/domain/diff.ts`) is a port of `parse-patch.ts` from the cockpit without what the phone does not show (split view, word markers, expandable context).
- `binary` / `image` → a single line of text; we do not load images (the rule from S-05). An empty `patch` without binaryness (a pure rename or permission change) → "No content changes".
- Runtime validation as everywhere: `files` must be an array, otherwise an error (never "no changes"); a file without `path`/`patch` drops out on its own; an unknown `status` → "changed" (rule 5). `stat` is computed from the rows, so the header matches the list.
- Refreshing: on return to the app; every 30 s only while the task is active (`isRunActive`); no silent retries. Timeout 15 s (large responses).

## 3. Live streams (SSE)

All of them send a `ping` every dozen or so seconds. Anti-buffering headers are set by the server; nginx must have `proxy_buffering off` (Cezar's installer already does that).

### 3a. `GET /api/v1/workspace/events` — the whole workspace (list screen)
A workspace route (no `/p/:projectId/` variant, like `runs-index`). Frame shapes read from `server/server.js` @ `v0.11.0` and captured live over loopback (2026-09-21) — **the project stamp is `project`, not `projectId`**:

| event | data |
|---|---|
| `run` | the full `RunRecord` after every change + `project` (`{ ...run, project }`) |
| `run-deleted` | `{ id, project }` |
| `todos` | `{ project, items }` (only with `CEZ_FOLLOWUPS=1`) |
| `usage` | `{ project, usage: { [runId]: { cpuPct, rssBytes, procCount } } }` — every ~2 s, only when some run has a live process; a project without live rows gets no frame |
| `project-added` / `project-removed` | a project entry (`project-removed` carries `id`) |
| `provider-status` | agent sign-in state (no stamp, host-wide) |
| `checkout-progress` | cloning progress |
| `ping` | empty, **every 15 s** |

There is no `id:` line — **there is no replay on reconnect**, after resuming **always** refetch `runs-index`. Headers: `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. The stream attaches projects whose context the server has already built, and attaches more as they appear (`onContextBuilt`).

**How the PWA uses this (S-04, `apps/pwa/src/api/workspace-events.ts`):**
- One `EventSource` per list screen. We listen only to the named events we use (`run`, `run-deleted`, `project-added`, `project-removed`, `usage`, `ping`) — new upstream names simply do not arrive (rule 5).
- `run` → a row via `toIndexEntry()` (a copy of `runIndexEntry()` from `server.js`), upserted into `['runs-index']` via `setQueryData`; `run-deleted` → removal. An unreadable frame is skipped, it does not throw. `usage` counts only as a sign of life (the row does not show CPU/RSS).
- Frames that arrive while `runs-index` is in flight are replayed onto its response (`FrameJournal`) — otherwise a slow refetch would overwrite a newer status with an older one.
- Connection state: `connecting | live | reconnecting | lost`. Our own backoff (1, 2, 5, 10, 30 s) instead of the browser's, a 45 s watchdog (three missed pings or a connection that never opened), `lost` after 20 s without a connection or immediately on `offline`. Every open → refetch `runs-index`; every drop → probe `health` again (EventSource does not expose the HTTP code, and an expired session is a bare 403).
- The stream is closed on `visibilitychange → hidden` and reopened on `visible` (iOS freezes the app).
- The list is "live" only when the stream is open **and** the refetch after opening has arrived; before that it shows "list as of HH:MM". Polling: 30 s when not live; 5 min as a safety net when live.

**How the `cezar-push` sidecar uses this (S-10, `apps/push-sidecar/src/watcher.ts`):**
- Over loopback (`http://127.0.0.1:4322` — the live instance's port, `cezar-cli serve --port 4322`), without the gate cookie. Node 20 has no `EventSource`, so the stream is read with `fetch` (`sse.ts`). Reads only: `workspace/events`, `workspace/runs-index`, `health` (project names).
- After every open: `runs-index` becomes the **baseline** and nothing in it is announced — a task that was waiting before the sidecar restarted or before the stream dropped does not ring. Frames that arrive before the baseline does fill it in silently (there is no way to tell whether they are older than the response; a lost notification is a lesser evil than a false one).
- `run` → `isEntering(before, run)` from `packages/shared/src/notifications.ts` (a port of `diffRunTransitions()` from `web/src/lib/notifications.ts`, keyed by project + id). `run-deleted` → forget. `project-added` → refresh names. The rest is ignored (rule 5).
- Backoff and watchdog as in the PWA (1, 2, 5, 10, 30 s; 45 s without a byte). It keeps only statuses in memory; it does not log titles or content.

### 3b. `GET /api/v1/p/:projectId/runs/:id/events` — one task (details screen)
Read from `server/server.js` and `runs/ui-event-sink.js` @ `v0.11.0`:
- Resume parameters: `?cursor=<liveCursor>` (from `/history` — a file offset, the server reads only the tail) and `?afterSeq=<n>`; the `Last-Event-ID` header works like `afterSeq`. The server replays every **persisted** line with `seq > max(afterSeq, cursor boundary)`, then goes live. An invalid cursor (the file got shorter) → `409` before the stream starts.
- Every event frame has `id: <seq>`.
- event `ui-event` — a v2 protocol line (dotted type), persisted **or** ephemeral
- event `run-event` — a v1 line (no dot). The history page has both, so we listen to both.
- event `run` — the whole `RunRecord` after every change and once after the replay ends
- event `ping` — every 15 s
- **`item.delta` never reaches the file.** Deltas are merged every ~40 ms and go out live only, with their own `seq` — a replay will not reproduce them. An `item.updated` with only a content increment is sometimes live-only too. `item.completed` always carries the final state.

**How the PWA uses this (S-06, `apps/pwa/src/features/run/useLiveTranscript.ts`):**
- The stream starts once the first history page is there: `cursor=page.liveCursor`, `afterSeq=page.asOfSeq` — the same way the cockpit connects.
- Lines go into `['history', projectId, runId]` via `setQueryData` (`appendLiveEvent` in `src/domain/live-transcript.ts`). The page's `asOfSeq` is a watermark: it grows with every line, a line with `seq <= asOfSeq` is dropped (**nothing twice** — this matters for v1 lines, which have no id). Every connection asks for `afterSeq = asOfSeq` (**nothing lost**).
- A delta goes only to an item whose last snapshot arrived **after** the current connection started. An item caught halfway by a freeze keeps the text from before the break until its snapshot arrives — it is never stitched together with a hole in the middle. Consecutive deltas of the same item and field merge into one line, and a snapshot removes its item's deltas.
- `run` → `['run', …]` (merged, keeps API-only fields such as `usage`) and the row in `['runs-index']`.
- State and lifecycle as in § 3a (shared `src/api/live-stream.ts`): backoff, watchdog, close on `hidden`, reopen on `visible` — that is the resume after an iOS freeze. A drop → probe `health`. An attempt that did not open → the next one **without** a cursor (a 409 would look like any other error, forever).
- Live: the record is polled every 5 min as a safety net, the page and the context not at all (the replay covers them). Without the stream: as in S-05 (30 s, on return). A page refetch that lands mid-stream gets back the lines newer than itself (`carryOver`).

### 3c. The agent event protocol (`ui-event`, `type`)
`session.started | session.ended | session.error | turn.started | turn.completed (usage, costUsd) | item.started | item.delta (field: text|reasoning|output, delta) | item.updated | item.completed | plan.updated (entries[]) | permission.requested | permission.resolved | ask.requested (questions[]) | usage.updated`

Items (`item`): `message` (role, text, phase), `reasoning`, `tool` (name, toolKind, title, status, input, output, error, diffs[], exitCode). The stream is **id-keyed**: `item.started` → many `item.delta` (append to the field) → `item.completed` (final state, overwrites).

The vocabulary is **append-only** — an unknown `type` must be safely ignored/rendered generically, and must never crash the UI.

### 3d. WebSocket `GET /api/v1/ws`
It exists on Cezar's side (on-demand topics, e.g. `health`), but **does not pass through the gate** — verified 2026-09-20. The vhost sets `proxy_set_header Connection ''` and does not forward `Upgrade`, so a WebSocket upgrade will not get through. This is a transport limitation, not a product decision: **SSE is the only path to the event stream.**

SSE, on the other hand, is confirmed to pass: `/api/v1/events` and `/api/v1/p/:projectId/events` return `text/event-stream` through the gate (`proxy_buffering off`, read timeout 3600 s).

## 4. Actions (writes) — require same-origin

| Action | Method and path | Body |
|---|---|---|
| New task | `POST /api/v1/p/:projectId/runs` → 201 | `{ task, workflow? \| steps?, runner?, model?, autonomous?, variants?(1-3), worktree?, images?(max 4) }` — exactly one of `workflow`/`steps`; default workflow `quick-task` |
| A message to a running session / an answer to `ask.requested` | `POST /api/v1/p/:projectId/runs/:id/messages` | `{ text, images? }` (an answer to a question = one combined message, see `web/src/routes/task-thread/ask-card.tsx`) |
| Cancel | `POST …/runs/:id/cancel` | — → `{ cancelled: boolean }` (`false` = the task had already finished, also 200) |
| Continue (a finished run) | `POST …/runs/:id/continue` | — or `{ text?, runner?, model? }` → `{ continued: true }`; an engine refusal = 409 |
| Finish / accept the review | `POST …/runs/:id/finish` | — → `{ finished: true }`; `409 no open session` |
| Draft PR | `POST …/runs/:id/pr` → 201 | — → `{ url, dryRun }`; 400 without a worktree, 409 `{ error, manual }` (a forge error or the run is active) |
| Edit a queued message (#66) | `PATCH …/runs/:id/queued-messages/:msgId` | `{ text?, images?(max 4) }` (at least one) → `{ message }` (the replaced entry, same `id` and `createdAt`). **400**: empty text without attachments, the stack's attachment limit, `prompt too long — … character limit across the task and its queued messages`; **404** `not found` (no run or no message); **409** `run already started`. The PWA sends only `{ text }` — attachments stay |
| Remove a message from the queue (#66) | `DELETE …/runs/:id/queued-messages/:msgId` | — → `{ removed: true }`; **404** `not found`, **409** `run already started` |
| Mark as read / unread | `POST …/runs/:id/read` / `…/unread` | — |
| Mark all as read (#67) | `POST /api/v1/p/:projectId/runs/read-all` | — → `{ read: number }` (how many were marked read). Stamps `seenAt` on every unread finished run of the **whole project** (`markAllRead()` in `runs/store.js` = a clause-by-clause copy of `isUnread`), including ones older than the index limit; the records come back through the SSE `run` event. No server-side filter, no bulk undo (one at a time: `…/unread`). Registered before `/runs/:id/…`, so `read-all` is never a run id |
| Pin / unpin | `POST …/runs/:id/pin` | `{}` or `{ pinned:false }` → the whole record |
| Archive / restore | `POST …/runs/:id/archive` | `{}` or `{ archived:false }` → the whole record (archiving also removes the pin and the scheduled resume) |
| Cancel auto-resume (#63, FR-030) | `DELETE /api/v1/p/:projectId/runs/:id/auto-resume` | — → `{ cancelled: true }` (`cancelAutoResumeResponseSchema`, `z.literal(true)`). Idempotent: a run without a scheduled resume also answers 200; only an unknown run is refused, **404**. Removes `autoResumeAt`, so the task becomes a plain `failed` (and lands in "Needs attention" by the unchanged rule). The PWA offers it only on a `failed` with `autoResumeAt`, behind a confirmation |
| Keep this variant | `POST /api/v1/p/:projectId/groups/:groupId/pick` | `{ runId }` → `{ winner? }` (the whole record; the key may be missing when the store cannot find it). The other variants: cancelled if alive, archived, worktree and branch removed. **409** `this variant is still active — wait for it to finish first`; **404** `not found` (no group) / `runId is not part of this group` |
| Pause / enable an automation | `POST /api/v1/p/:projectId/automations/:id/pause` / `…/enable` | — → `{ automation }`. Enabling sets a "from now on" baseline (the GitHub poll will not fire the backlog from the `lookbackDays` window). **404** `not found` |
| Run an automation now | `POST /api/v1/p/:projectId/automations/:id/run` → 202 | — → `{ runId }`. **Only `kind: schedule`**, regardless of `enabled`; does not touch `nextRunAt`. **409**: `a GitHub automation is run through check with mode execute`, `this instant was already launched`, `automation polling lease is held by another process`, `the launch failed — see the execution log` |
| Merge a PR (S-19) | `POST /api/v1/p/:projectId/github/prs/:number/merge` | `{ method: 'merge'\|'squash'\|'rebase', expectedHeadSha: <40 hex>, overrideRules?: boolean }` (`.strict()`) → `{ merged: true, number, url, method, mergeCommitSha? }`. The server first reads the state afresh (`refresh`) and refuses: **409** `The pull request head changed…` (`code: stale-head`), `That merge method is no longer enabled.` (`disabled-method`), the first `blocker` (code = `eligibility`), `A merge is already in progress.` (`concurrent`), `GitHub refused the merge.` (`github-blocked`); `409 GitHub merge is unavailable` without a forge; **403** `GitHub permission denied.`, **404**, **502** (`reason` from the state read). `overrideRules: true` passes only with `canOverride` |

### Answering the agent and messaging in the PWA (S-07) — how we write
- **The `/messages` response** is one of three: `{ delivered: true }` (the live session accepted it), `{ queued: true, message }` (the task is queued — appended to the prompt, visible in the record's `queuedMessages[]`, not in the history), `{ deferred: true }` (the session is starting — the message waits for it to open). Anything else is a `409`, e.g. `session closed` or a reason from the provider gate.
- **Routing as in the cockpit (`ask-answer.ts`, `v0.11.0`):** an active task (`running`/`waiting`/`queued`) → `POST …/messages { text }`. A closed task with a saved session (`steps[].sessionId`) → `POST …/continue { text }` — the text becomes the prompt that opens the resumed session (without `runner`/`model`, so the engine stays the same). A `409` from `/messages` with a saved session = a stale record → the same answer goes through `/continue` instead of getting lost. When that fails too, the operator sees the `/messages` refusal reason, not the fallback attempt's reason. The only retry: `409 run is still active` from `/continue` (the session closes after an idle timeout), on the cockpit's schedule, about 6 s in total. **The reverse direction (Cezar #986, `deliver-prompt.ts` @ `v0.11.1`):** the record says "finished" but the task is still running → `/continue` answers `409`. Then the record is fetched once more, bypassing the cache (`staleTime: 0`); if the fresh record says the session is alive, the text goes through `POST …/messages` (and the cache stops lying). If the fresh record agrees with the route attempted, the operator sees the `/continue` refusal unchanged.
- **Answer format for a question** (`ask.requested`): `"<header>: <labels, comma-separated>"`, several questions = one message, a line per question. The reducer resolves the card on the **next** `user-message`, so an answer in your own words (any message) also closes it. Only the newest question is interactive — an older unresolved one can no longer resolve.
- The composer is only for active tasks and for closed ones with an open question; a plain "continue" is S-08. The write has a 20 s timeout and is **not retried**: after a timeout the message may have arrived, so the operator gets that sentence instead of a second send. The draft stays in the field until Cezar accepts it.
- After every attempt (successful or not) we invalidate `['run', …]`, `['history', …]` (with the context) and `['runs-index']`.

### Queued messages in the PWA (#66) — editing and removing
- Works only for `status: queued`. Cezar folds the stack into the prompt at start, but `queuedMessages[]` stays in the record for the run's whole life — after the start the PWA shows the stack read-only (`queuedMessagesEditable()` in `apps/pwa/src/domain/queued-messages.ts`), because both routes would answer `409`.
- In-place editing, the same rules as the composer: empty text and no change do not send; the draft stays on refusal. Removing behind a confirmation. One write at a time, 20 s timeout, no retries.
- The response goes into `['run', projectId, runId]` via `setQueryData` (only that stack entry, `applyQueuedMessage()`); the SSE `run` event brings the whole stack a moment later.
- A `404`/`409` with Cezar's own `{ error }` = the message has already gone (the task started with it) → a calm "already sent" message, not an error; the record is refetched. Any other refusal shows Cezar's reason verbatim (FR-032).

### A new task in the PWA (S-13, FR-033/034) — how we create
- **The form:** project, description (`task`), `workflow`, `runner`, `model`, `agentProfile`, `autonomous`. `variants`, `dispatch`, `steps`, `images`, `systemPrompt`, `issueNumber` stay in the cockpit (#62). The body omits unselected keys (no `model` = "Auto", the runner picks itself); `autonomous` is always sent.
- **Default choices as in the cockpit:** workflow `quick-task` (or the first on the list), runner = the project's `config.defaultRunner` if installed, then `health.defaultRunner`, then the first available. Installed runners = `health.checks[]` with `available: true` (excluding `gh`/`git`); on this host only `claude`. Model = `config.defaultModels[runner]` if it is in the catalog; with `modelsLocked` there is no model field. The account picker only when `agent-profiles` has accounts for that runner.
- **The 201 response is a union** (`createRunResponseSchema`): a record (`id`) or `{ runs: [...] }` — we open the first. Navigation with `replace` to `/m/p/:projectId/runs/:id` (back = the list, not the submitted form). After success we invalidate `['runs-index']`.
- **A refusal** (e.g. `400 unknown workflow: …`) → `{error}` verbatim (FR-032), the description stays in the field. 20 s timeout, no retries: the task may have been created, so the operator is asked to check the list.

### Task actions in the PWA (S-08) — when we show which
- **The policy = a copy of `runActionFlags()`** from `web/src/routes/task-thread/run-actions.ts` @ `v0.11.0` → `apps/pwa/src/domain/run-actions.ts`. "Active" = `running | queued | waiting` (`review` is **not** active). Cancel: active. Finish: `waiting` (closes the session) or `review` (accepts the changes without a PR — the same endpoint, a different label). Continue: not active **and** a saved session (`steps[].sessionId`). Archive/restore: not active. Pin/unpin: not archived.
- **Draft PR** — like the cockpit's review panel (`review-panel.tsx`): only on `review` and only when `pullRequestUrl` is not an http(s) link (a second tap would open a duplicate). After success the server sets `pullRequestUrl` and finishes the run as `done`. We do not show the `manual` commands from the 409 response — `git merge` does nothing on a phone; we show the reason.
- **Cancel** only after confirmation (FR-025). `{ cancelled: false }` → the message "it had already finished", not success.
- **Continue** without a body: the server resumes the session on the run's engine (without `runner`/`model`).
- One action at a time; the bar also waits for a send from S-07. 20 s timeout, no retries (the action may have run). The refusal reason verbatim (FR-032). After every attempt we invalidate `['run', …]`, `['history', …]` and `['runs-index']`; the pin/archive response goes into the cache **only as a flag** (like `seenAt` for `/read`), `archived` also into the list row — the list hides archived tasks immediately.

Action on `permission.requested`: the answering mechanism is to be confirmed in `packages/web/src/routes/task-thread/` before implementation (by default Cezar runs with `dontAsk`, so permission requests appear only with `CEZ_APPROVAL_GATE=1`).

### Task variants in the PWA (S-21, #71) — the list and "Keep this one"
- A task launched ×2/×3 is several runs with the same `groupId` (the letter in `variant`). `runs-index` does not carry it, so the "Variants" panel appears on the task screen when the **record** has a `groupId`, and reads `GET …/groups/:groupId` (key `['group', projectId, groupId]`, 15 s timeout like `/changes`, because the server computes `git diff --stat` in every worktree). Every 30 s while any variant is active; after that only on return to the foreground — and immediately when the status or archiving of the current task changes (its record is live from the stream).
- A row: the letter, the status (as on the list), the number of changed files from the last line of `diffStat` (`N files changed`; `''` = "unknown", not zero) and the cost. A sibling's row opens its task screen. Side-by-side diff comparison stays in the cockpit (N07).
- "Keep this one" only after confirmation and only when: the current variant is not archived and at least one other variant is not archived (otherwise the group is already decided). An active variant (`running | queued | waiting`) shows the sentence "you can keep it once it finishes" instead of the button — the server would answer 409 anyway.
- 20 s timeout, no retries (the pick may already have archived the rest). The refusal verbatim (FR-032). After every attempt we invalidate the group, all `['run', projectId, …]` (the losers were archived), the history and `['runs-index']`. The S-08 action bar and the panel wait for each other.
- There is no group on the host today (0 of 41 runs in the index with a `groupId`, as of 2026-09-24), so the fixture `apps/pwa/test/fixtures/group.json` is hand-written, validated with the `groupResponseSchema` schema.

### Automations in the PWA (S-20, #70) — reacting only
- Screen `/m/automations?project=…`, linked from the task list only when `health.capabilities.automations === true` (when it is off, the screen says so plainly and asks nothing — the family would answer 409). Creating, editing, deleting and the `/check` preview stay in the cockpit (N05, PRD Non-Goals after the D07 narrowing of 2026-09-24).
- A row: name, `Enabled`/`Paused`, the trigger (the schedule in words with the contract's defaults — the hour is in the server's `timeZone`, `UTC` on the host, so when the phone's clock differs we append the zone: `Every day at 04:00 (UTC)`, because "Next …" is already in phone time — or the GitHub events), the last run (`lastRun`, then `state.lastRunAt`) with a link to the task, the next one (`nextRunAt`, only when enabled). `available: false` → a note with the server's `reason` verbatim; the list stays (schedules work without GitHub).
- **Run now only for `kind: schedule`** — the server rejects a GitHub poll (`409`, it is launched through `/check`, out of scope). Run now is behind a confirmation (brief R03: it launches a task). Pause/Enable without confirmation.
- One action at a time for the whole screen, 20 s timeout, no retries (Run now may already have launched a task after a timeout). The refusal verbatim (FR-032). After every attempt we invalidate `['automations', projectId]` and `['automation-log', projectId]`, after Run now also `['runs-index']`; a successful Run now links to the new task.
- Nothing streams automation changes to the PWA: the list and the log refresh every 30 s and on return to the foreground. The log shows the 10 newest entries, the rest (up to 100) on demand.
- On the host (`0.11.1`, 2026-09-24) both projects have `automations: []`, so the `automation{s,-log}.json` fixtures are hand-written, validated with the contract schemas.

### Merging a PR in the PWA (S-19, #69) — state, checks and a merge behind a confirmation
- A "Pull request #N" panel under the task actions, when the header has a PR link with a number (`prLink()`: the PR created by the task, then the PR the task is about). It reads `GET …/github/prs/:number/merge-state` (key `['merge-state', projectId, number]`) every 30 s and on return to the foreground; a merged or closed PR is no longer polled. The route is relative to the project's repo, so when `mergeState.url` does not point at the same PR as the task's link (another repo, the same number), the panel says so plainly and does not offer a merge.
- The panel header and the check order (`failing → pending → unknown → passing`) are `apps/pwa/src/domain/merge.ts`. Each check's state is a word next to the glyph, not colour alone. Block reasons are the server's `blockers[].message`, verbatim, in its order. `available: false` → "The merge state is unavailable:" + `reason` verbatim.
- **We offer a merge exactly when the server would accept it** (`mergeGate()`): `canMerge`, or `canOverride` after ticking "Merge without waiting for requirements" (then the body has `overrideRules: true`) — like `GithubMergeBox` in the cockpit (`web/src/routes/github/github.tsx`). On this host a private repo does not show branch protection rules (`required: null`, `reviewDecision: unknown`), so an open PR usually has `eligibility: unknown` and `canMerge: false` — without the override it could not be merged from either the cockpit or the phone.
- The merge is behind a confirmation with the PR number and title and the target branch (brief R03); the method is chosen there from `methods` (default `defaultMethod`). The body carries `expectedHeadSha` = `headSha` from the state shown: the server rejects a push in the meantime (`stale-head`) instead of merging unseen commits.
- **Never optimistically.** After every attempt (success, refusal, timeout) the state is read afresh with `refresh=1` and that is what is shown; we also invalidate `['run', …]`, the history and `['runs-index']`. 20 s timeout, no retries (the merge may have gone through). The refusal verbatim (FR-032). Draft → ready conversion, files, reviews and comments stay on GitHub (N06).
- Fixtures: `merge-state.live-0.11.1.json` (this repo's merged PR #78, from the host) and the hand-written `merge-state.json` (open, one check failing, one pending), validated with `githubPrMergeStateResponseSchema`.

## 5. "Needs attention" — the notification rule

A 1:1 copy of `deriveAttention()` from `packages/web/src/lib/attention.ts` @ `v0.11.1` → `packages/shared/src/attention.ts` (reconciled with the source 2026-09-21, compared again 2026-09-24 — the file is identical to `v0.11.0`, together with upstream's table-driven tests). Cezar #995 (a turn waiting only on its own subagents is no longer "needs you") is a server-side fix (`workflows/run.ts`): such a turn parks as `status: 'running', activity: 'monitoring'` instead of `status: 'waiting'`, so the same rule — in the PWA and in the sidecar — stops showing and pushing it without a code change here. It returns `{ bucket, tone, pulse, label }`, first-match-wins:
1. a pending `permission.requested` → `permission` — **hard-coded `false` upstream too, an unreachable branch, see 5a**
2. `failed` + `autoResumeAt` → `none` / "scheduled" — **no** attention
3. `failed` → `error`
4. `waiting` → `waiting` / "needs you"
5. `review` → `waiting` / "needs review"
6. `running` + `activity: 'monitoring'` → `running` / "monitoring" — no attention
7. `running` → `running`; `queued`, `done`, the rest → `none` (**the last rung is a catch-all labelled "cancelled"** — the PWA shows an unknown status as its raw name, not as "cancelled")

"Needs attention" = `wantsAttention()` = the buckets `permission | error | waiting` (i.e. `waiting`, `review`, `failed` without `autoResumeAt`). It is the cockpit's notification predicate and **the same** answer for the PWA list's top section and the badge (PRD, Business Logic). Note: the cockpit sidebar has a narrower "Needs you" bucket (only `waiting`/`review`; `failed` lands in "Recent") — the PRD deliberately follows the notification rule, not the sidebar.

Read/unread (the marker in the row) is a separate channel: a copy of `web/src/lib/read-state.ts` → `packages/shared/src/read-state.ts` (`isUnread`: `done`/`failed`, not archived, not scheduled, `seenAt < finishedAt`).

We notify when a task **enters** a state that needs attention (a transition, not a state), just like `web/src/lib/notifications.ts`. Since S-10 this is code: `isEntering()` in `packages/shared/src/notifications.ts` — a first sighting and an unchanged status never ring; a change between two attention states (`waiting` → `failed`) rings.

### 5b. The notification — what it carries (S-10)
The sidecar sends a structure, not text (`PushPayload`): `{ kind: 'attention', projectId, projectName, runId, title, reason }`, where `title` = the first line of `titleSummary ?? title`, truncated to 100 characters, and `reason` = `deriveAttention().label`. The service worker composes the words from `i18n/en.ts` ("Waiting for your answer", "Waiting for review", "Ended with an error"). No code, no transcript content (FR-043). `tag` per task — a newer notification about the same task replaces the older one. Tap → `/m/p/:projectId/runs/:runId`; an open app window gets a `postMessage` and navigates there in place, without a reload (FR-041). Sidecar endpoints: `apps/push-sidecar/README.md`.

**Limit notification (#94).** The one non-task notification (PRD Non-Goals, narrowed 2026-09-25): `{ kind: 'limit', provider, account, window, model?, level: 'near' | 'exhausted', usedPercent, resetsAt? }`, sent by the sidecar after a limits poll (§ 6) when a window enters `LIMITS_NOTIFY_PERCENT` (default 90) or 100% **while a task is queued or running** — once per level until the window resets, remembered across restarts in `STATE_DIR/limit-alerts.json`. Rule: `limitCrossings()` in `packages/shared/src/notifications.ts`. The service worker shows "Claude · 5-hour window" / "92% used · resets in 1h 20m · tasks are waiting to run" (account named unless `default`), `tag` per window so `exhausted` replaces `near`; tap → `/m/limits`. An unknown `kind` is still shown as an attention notification, never a throw.

### 5a. `permission.requested` is a dead type (verified 2026-09-20)

Branch 1 will never execute on this instance. Three layers of evidence:

1. **The switch is not set.** `CEZ_APPROVAL_GATE` is read in `dist/core/claude-cli-runner.js:322` (`env.CEZ_APPROVAL_GATE === '1' ? 'acceptEdits' : 'dontAsk'`). Of Cezar's variables, the live process has only `CEZ_REMOTE=1`; the unit declares `CEZ_REMOTE` and `PATH`. The runner starts with `--permission-mode dontAsk`.
2. **`dontAsk` generates no prompts by definition.** Tools from `--allowedTools` pass, the rest are rejected instead of asking. A refusal lands as `ToolStatus: 'declined'`, not as a permission request.
3. **The event itself has no emitter.** `dist/core/ui-events.d.ts:270`, `UiPermissionRequestedEvent`, with the comment `RESERVED — wired when auto-approve becomes optional. Types only for now.` Hits: 2 in `.d.ts`, 0 in runtime `.js`, 0 in the whole web UI.

The second runner does not change the picture: `codex` has `approvalPolicy: 'never'` hard-coded (`codex-app-server-runner.js:291`), and in any case `codex.available: false`, `defaultRunner: claude`.

**Caveat:** setting `CEZ_APPROVAL_GATE=1` **will not bring** this branch to life. The variable only switches the CLI permission mode to `acceptEdits`; Cezar still has no code that would turn a `control_request can_use_tool` into a UI event. Bringing this path to life is a change in Cezar — out of the PWA's reach (see rule 7 in `CLAUDE.md`: we file it as a proposed upstream issue).

**What we do about it in code:** the branch **stays** in `packages/shared/attention.ts`. Rule 8 requires a 1:1 copy from Cezar, and the event vocabulary is append-only — the emitter may arrive in any version. Removing the branch would split us from the cockpit exactly when Cezar wires it up. We treat it as unreachable, not as nonexistent: no E2E tests, no UI for answering a permission request, with a unit test keeping parity with the original.

## 6. Provider usage limits — `GET /m/push/limits` (sidecar, #92)

Not a Cezar route: Cezar learns about a subscription limit only after a run hits it
(`usage limit reached|<epoch>` → `autoResumeAt`). `cezar-push` polls each agent account every five
minutes and serves the last pass behind the same gate as the rest of `/m/push/`
(`LimitsResponse` in `packages/shared/src/limits.ts`; details in `apps/push-sidecar/README.md`):

```json
{ "observedAt": "…", "providers": [
  { "provider": "claude", "account": "default", "status": "ok", "observedAt": "…",
    "windows": [ { "kind": "five_hour", "usedPercent": 42, "resetsAt": "…" },
                 { "kind": "weekly_model", "model": "opus", "usedPercent": 61, "resetsAt": "…" } ] },
  { "provider": "codex", "account": "default", "status": "unavailable", "reason": "codex not installed",
    "observedAt": "…", "windows": [] } ] }
```

| Provider | Source | Stability |
|---|---|---|
| Codex (ChatGPT plan) | `codex app-server` → JSON-RPC `account/rateLimits/read`: `rateLimits.primary`/`secondary` = `{ usedPercent, windowDurationMins, resetsAt }` (Unix seconds). A window is identified by `windowDurationMins` — the 5-hour row can be missing and then the weekly one is `primary` | Official app-server method. Codex is not installed on this host (`codex.available: false`), so the row reads `codex not installed` |
| Claude Code (Pro/Max) | `GET https://api.anthropic.com/api/oauth/usage`, `Authorization: Bearer <claudeAiOauth.accessToken>`, `anthropic-beta: oauth-2025-04-20`: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` = `{ utilization, resets_at }` or `null` | **Undocumented**; off unless `LIMITS_CLAUDE=1`. The documented sources don't work headless: the status line's `rate_limits` is interactive only, and `stream-json`'s `rate_limit_event` has no percentage (anthropics/claude-code#78476) |

A window the provider does not report is absent, never 0 or 100. A failed read is `unavailable` +
`reason`, never the previous numbers. Upstream proposal: a `limits` field on Cezar's own provider
and account rows (`/api/v1/providers/status`, `/workspace/agent-profiles`), after which this
collector can go.

### The Limits screen in the PWA (#93) — how we read `/m/push/limits`

`/m/limits`, linked from the list header, from Settings and from a task waiting for a limit reset
(`failed` + `autoResumeAt`, beside *Cancel auto-resume*). `apps/pwa/src/api/limits.ts` reads through
`pushFetch`, so a lost session, the SPA fallback answering for a missing sidecar (`not-routed`) and
timeouts are judged in `http.ts`; a body without `providers[]` is `unexpected-shape`, a window with
an unknown `kind` is dropped. Query key `['limits']`: read on open and on return to the foreground
(`refetchOnWindowFocus: 'always'`), **no `refetchInterval`** — the sidecar polls, the phone doesn't.

`apps/pwa/src/domain/limits.ts` turns the answer into cards: Claude, then Codex, `default` account
first. Each `ok` card shows 5-hour and weekly — **always**, *Not reported* when the provider left
one out, never 0 % or 100 % — then any `weekly_model` rows the provider did report. Every bar is a
`role="meter"` with the percentage also in text, "resets in 2h 14m", and the row's age; a row whose
`observedAt` is older than **10 min** has its numbers dimmed and says *Stale*. An `unavailable`
row shows the sidecar's `reason` verbatim, badged *Off* when it begins `off …` (switched off in the
sidecar config) and *Unavailable* otherwise. A failed refresh keeps the last reading on screen
under a banner. The service worker's navigation fallback denies `/m/push/**` and it registers no
runtime cache (`apps/pwa/src/pwa/sw-routes.ts`, pinned by `apps/pwa/test/sw-routes.test.ts`).
