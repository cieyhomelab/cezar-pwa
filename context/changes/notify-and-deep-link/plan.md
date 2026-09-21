# Notify and deep-link — Implementation Plan

## Overview

Close roadmap slice **S-10** (`notify-and-deep-link`). The operator turns notifications on from a
deliberate tap in Settings (FR-036). In a browser tab they are shown how to install instead (FR-037).
When a task enters a state that needs them, a push reaches the locked phone, saying which task,
which project and why (FR-038), with no code and no transcript content (FR-043). Tapping it opens
that task's transcript, reusing an open window (FR-041).

Derived from `context/foundation/roadmap.md` § S-10, the PRD, `docs/REQUIREMENTS.md` § 4.5 / § 6 and
Cezar's source at `v0.11.0`. See `change.md`.

## Current State Analysis

| S-10 capability | State before this change |
| --- | --- |
| Sidecar | **placeholder**: `apps/push-sidecar` served "Hello Hono!". |
| Transition rule | **absent**. The attention rule was shared; "entering" was only a sentence in `docs/CEZAR_API.md` § 5. |
| Service worker | `push` / `notificationclick` handlers existed, but the deep link was `/m/run/<p>/<r>`, a route the router never had. It navigated an open window with `client.navigate`, which reloads it. |
| Settings | **absent**. No screen, no way to subscribe. |
| nginx | `/m/push/` was commented out, waiting on the gate mechanism (then open question Q1). |
| systemd unit | Existed, but pointed at port 4321; the instance listens on 4322. |

### Key discoveries

- **The gate already exports what `/m/push/` needs.** The cookie gate is a `map` at http level
  (`$cezar_gate_ok`) plus `if` blocks in a snippet. `/m/push/` reuses the variable and holds no
  secret. On a host without the map, `nginx -t` fails and `install.sh` rolls back, so the endpoints
  can never go up ungated.
- **The cockpit has the rule.** `diffRunTransitions()` in `web/src/lib/notifications.ts`: notify
  only on a status that CHANGED into one that `wantsAttention`; first sight and an unchanged status
  are silent; `waiting` → `failed` is news. Ported per run (the sidecar sees one record per frame)
  and keyed by project too, because the workspace stream spans projects.
- **Loopback is ungated.** Cezar on `127.0.0.1:4322` answers `/api/v1/*` without the cookie, so
  the sidecar needs no credential at all. Verified live: stream open, baseline of 14 runs.
- **iOS wants the permission prompt straight from the tap.** The public key is fetched when the
  screen opens, so the tap goes straight to `Notification.requestPermission()`.

## What We're NOT Doing

- **No icon badge** (FR-042, parked). The old handler's `setAppBadge` is removed rather than left
  half-wired.
- **No notification on `done`** (F-PUSH-5 / REQUIREMENTS Q5). The PRD cut it.
- **No persisted transition state.** A sidecar restart re-seeds silently. That is S-11's design
  question: never announcing old work is the chosen failure. S-11 still owns proving it holds.
- **No sign-out teardown.** Clearing the subscription on sign-out is S-12.
- **No Android-specific work.** A PRD non-goal. The endpoint allowlist accepts Google's push service
  only because a laptop browser would hand one out.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | The rule, shared: `isEntering`, `runKey`, `attentionPayload`, `notificationTitle` (first line of the summary, 100 chars) | `packages/shared/src/notifications.ts` |
| 2 | The sidecar: SSE over `fetch`, silent baseline on every (re)connect, backoff + watchdog, Web Push with a 24 h TTL and `urgency: high`, 404/410 drop, JSON store with atomic 0600 writes and an endpoint allowlist, VAPID `init`, Hono routes with an origin check and an 8 KB body limit, bundled to one file | `apps/push-sidecar/src/*`, `build.mjs` |
| 3 | The PWA: `pushFetch` (same auth judgements as `apiFetch`), Settings screen with the notifications section, subscription hook, footer link | `api/http.ts`, `api/push.ts`, `domain/push-setup.ts`, `features/settings/*`, `App.tsx`, `routes.tsx`, `i18n/pl.ts` |
| 4 | The worker: payload → notification text via `pl.ts`, per-task tag, the real task URL; a tap focuses an open app window and posts where to go, and the page routes in place | `sw.ts`, `pwa/push-message.ts`, `pwa/useNotificationNavigation.ts` |
| 5 | Deploy: gated `/m/push/` in nginx (+ rehearsal), user unit on 4322, `deploy/push/install.sh` | `deploy/nginx/*`, `deploy/systemd/cezar-push.service`, `deploy/push/install.sh` |
| 6 | Tests, E2E, evidence, docs | see Progress |

### Design notes

- **Structured payload, words in the PWA.** The sidecar sends `{ kind, projectId, projectName,
  runId, title, reason }`. The service worker turns `reason` into Polish through `pl.ts`, so all copy
  stays in one file (NF-8) and the sidecar ships no copy.
- **A sidecar that cannot store the device leaves it off.** If the POST fails after `subscribe()`,
  the hook unsubscribes again. The screen never says "on" for a device nothing will reach.
- **Off means off on the device first.** Disable unsubscribes locally before telling the sidecar. A
  stale server entry dies at the next push (410 → dropped).
- **Test to this device only** (`POST /m/push/test { endpoint }`). A 404 means the sidecar has
  forgotten the device, and the screen says to re-enable. A 410 means the push service has, and the
  local subscription is dropped too.
- **Frames before the baseline are applied silently.** It cannot be told whether they are older
  than the index answer, and a missed ring is the lesser failure next to a false one.
- **The sidecar keeps statuses only**, and logs counts and states, never a title.

## Progress

- [x] **Unit tests**: 658 passing (`npm test`), 121 of them new: shared transition table (14 rows)
      and payload; sidecar SSE parser (live recording, split chunks, CRLF), store (0600, upsert,
      cap, refuses to wipe an unreadable file), watcher (baseline silence, re-announce rules, project
      keying, deleted runs, early frames, watchdog, reconnect), routes (origin, allowlist, body
      limit, test-to-one, 410 drop, health without content), pusher; PWA availability table, VAPID
      key decoding, notification text/tag/URL, in-place routing, and the Settings section across
      every device state and round trip.
- [x] **E2E (WebKit, iPhone 14)**: 54 passing (`npm run test:e2e`), 4 new in `test/e2e/notify.spec.ts`
      — tab shows install (no button, no sidecar call); installed enable → test → disable against a
      stubbed sidecar, 44 px target; a posted notification tap routes the open window in place (no
      reload); the cold deep-link URL is the task screen.
- [x] `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm ci` accepts the trimmed lockfile.
- [x] **nginx rehearsal** (`deploy/nginx/rehearse.sh`): 3 new expectations — `/m/push/` 403 without a
      session, the `?key=` guard does not apply there, and with a session the sidecar gets the full path.
- [x] **Live, sidecar only** (2026-09-21, loopback, reads only): the bundle connected to the instance's
      workspace stream, took a 14-run baseline without a push, answered `/health`, refused a
      cross-origin write, and stayed live past the watchdog on pings.
- [x] Screenshots at 390×844, both themes (`evidence/`).
- [ ] **Install on the VPS**: `deploy/push/install.sh` (as `ubuntu`), then
      `sudo deploy/nginx/install.sh /etc/nginx/sites-available/cezar-cezar-ciey-studio`. This is a
      production change, so it waits for the operator.
- [ ] **Device pass (iPhone, iOS 16.4+)**, which no simulator substitutes for:
  - [ ] In Safari, Settings shows the install instructions and no button.
  - [ ] From the icon, "Włącz powiadomienia" prompts. Allow → "włączone".
  - [ ] "Wyślij powiadomienie testowe" arrives with the app closed and the phone locked.
  - [ ] A real task entering waiting/review/failed rings once, reading title · project · reason.
  - [ ] Tap with the app closed → that task's transcript. Tap with the app open on another screen →
        the same window moves to the task.
  - [ ] A second transition of the same task replaces the first notification.
  - [ ] Restarting `cezar-push` (`systemctl --user restart cezar-push`) rings nothing for tasks
        already waiting.
