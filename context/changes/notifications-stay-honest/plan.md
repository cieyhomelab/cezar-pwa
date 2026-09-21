# Notifications stay honest — Implementation Plan

## Overview

Close roadmap slice **S-11** (`notifications-stay-honest`). The operator is not notified twice
about the same transition, and a newer notification about a task replaces the older one (FR-039). A
destination the platform reports as gone is dropped, so nothing keeps targeting a device the
operator no longer has the product on (FR-044).

Derived from `context/foundation/roadmap.md` § S-11, the PRD, `docs/REQUIREMENTS.md` F-PUSH-7 /
F-PUSH-9 and the S-10 code. See `change.md`.

## Current State Analysis

What S-10 (PR #22) already did, and what was left:

| S-11 requirement | State after S-10 | Gap |
| --- | --- | --- |
| One ring per transition | The watcher rings only when a run's status CHANGES into one that wants attention. The baseline is re-seeded silently after every (re)connect. | Nothing proved it across a real drop or a restart. A notifier that threw synchronously escaped `handleFrame` and took the stream down. |
| Newer replaces older, on the phone | Per-task `tag` in `push-message.ts`. | Browsers replace a same-tag notification **silently** by default, so a task going from "needs you" to "failed" updated an old notification without alerting. |
| Newer replaces older, before delivery | Nothing. | A phone that was off while a task went `waiting`, then `failed`, woke to both pushes (24 h TTL). |
| Gone device dropped | 404/410 from the push service → removed from the store. The test route answers 410, and the app drops its own copy. | A subscription past its `expirationTime` was still called. |
| The sidecar knows the device's *current* subscription | Enable/disable keep the two in step. | A push service can replace a subscription on its own. The old endpoint was dropped at 410, but the new one never reached the sidecar, and Settings kept saying "on". Re-enabling with a new VAPID key left the old endpoint in the store until a push bounced. |

## What We're NOT Doing

- **No announcing transitions missed while the sidecar was down.** S-10 chose this and the roadmap
  records it: the missed ring is the chosen failure over a false one. A reconnect-time diff against
  the previous baseline could ring for them without ever repeating. It is left as a possible
  follow-up, since it trades a missed ring for pushes about work the list already shows.
- **No persisted transition state.** Restarting is first sight for every run, so it never repeats.
- **No dropping on other push-service errors** (5xx, 429, 403). They are the service's or the
  sidecar's problem, not proof that the device is gone. FR-044 is about what the platform reports as gone.
- **No closing stale notifications when a task is answered elsewhere.** Not in FR-039. A candidate
  follow-up.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | Sidecar: `topicFor()`, a hash of `project/run`, at most 32 base64url chars, sent as the Web Push `Topic` on attention pushes (never on the test). `isExpired()`: an expired subscription is dropped without calling the push service and counts as `gone`, so the test route answers 410. The notifier is called inside a promise executor, so a synchronous throw is a logged rejection. | `apps/push-sidecar/src/push.ts`, `watcher.ts` |
| 2 | Worker/page: `renotify: true` on attention notifications (always tagged). `subscription-sync.ts`: `resyncSubscription()` (upsert on launch) and `replaceSubscription()` (worker's `pushsubscriptionchange`: store the new one, re-subscribing with the old key if none was handed over, then drop the old endpoint even if storing failed). `useSubscriptionSync()` in `App`. Enable drops an old-key endpoint on the sidecar. | `apps/pwa/src/pwa/push-message.ts`, `pwa/subscription-sync.ts`, `pwa/useSubscriptionSync.ts`, `sw.ts`, `App.tsx`, `features/settings/usePushSubscription.ts` |
| 3 | Tests, docs | see Progress; `apps/push-sidecar/README.md` |

### Design notes

- **Topic is a hash.** The topic travels to Apple in the clear. A hash keeps project and run ids
  out of it, and still keys by project, since run ids are only unique within one.
- **The test push has no topic.** Otherwise the operator's test could replace a real notification
  still waiting to be delivered.
- **Re-sync is an upsert.** Storing is keyed on the endpoint, so re-posting on every launch changes
  nothing for a device the sidecar already knows. It is quiet: a sidecar that is down is Settings'
  to report when the operator looks.
- **Rule 4 holds.** The worker now calls `/m/push/subscription`. That is the sidecar, not Cezar's
  `/api/**`, and it is not a stream.

## Progress

- [x] **Unit tests**: 681 passing (`npm test`), 23 of them new. Sidecar: one ring across a real
      stream drop with Cezar re-sending the record, and none after a restart until the next
      transition; a throwing notifier neither drops the stream nor retries; same topic per task,
      different per task and per project, bounded and opaque; no topic on the test; expired
      subscriptions dropped without a call, a future one kept, a test to an expired one → 410. PWA:
      `renotify` with a tag; re-sync on launch and its quiet cases; `pushsubscriptionchange`
      ordering, re-subscribe with the old key, drop-on-failure, never removing what it just stored;
      Settings drops an old-key endpoint.
- [x] **Deliberate-break check**: removing the topic, the expiry check, `renotify`, the endpoint
      guard in `replaceSubscription`, or the old-key DELETE each fails a test.
- [x] **E2E (WebKit, iPhone 14)**: 55 passing (`npm run test:e2e`), 1 new in `test/e2e/notify.spec.ts`.
      An installed, already-subscribed app re-registers its subscription on launch.
- [x] `npm run typecheck`, `npm run lint`, `npm run build` clean. The built `sw.js` carries the
      `pushsubscriptionchange` handler.
- [ ] **Install on the VPS**: as for S-10, `deploy/push/install.sh`, then the nginx installer.
      On 2026-09-21 the host had no `cezar-push` unit, and the live `/m/` snippet still had
      `/m/push/` commented out. This is a production change, so it waits for the operator.
- [ ] **Device pass (iPhone)**, the S-10 checklist items that are S-11's:
  - [ ] A second transition of the same task replaces the first notification, and it rings.
  - [ ] Restarting `cezar-push` (`systemctl --user restart cezar-push`) rings nothing for tasks
        already waiting.
  - [ ] Delete the app from the home screen, then trigger a transition: the sidecar logs
        `dropped a subscription the push service reports gone`, and `/m/push/health` shows one
        subscription fewer.
