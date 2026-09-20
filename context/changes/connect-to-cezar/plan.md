# Connect to Cezar — Implementation Plan

## Overview

Close roadmap slice **S-02** (`connect-to-cezar`): the operator can tell from inside the
installed app that it is not authorized, is shown "Połącz z Cezarem" instead of an error or
an empty list, and can re-unlock the app from where they are standing.

Derived from `context/foundation/roadmap.md` § S-02, PRD FR-004 and FR-005, and the
gateway mechanics measured in `docs/CEZAR_API.md` § 1a. See `change.md` for why this plan
is derived rather than authored, and how the slice's recorded blocker was resolved.

## Current State Analysis

| S-02 capability | State before this change |
| --- | --- |
| An HTTP layer that can recognise a refusal | **absent** — no `src/api/` at all |
| A session probe | **absent** |
| "Połącz z Cezarem" screen | **absent** (roadmap Baseline: "Auth: absent") |
| A way to unlock from inside the app | **absent**, and assumed impossible without a `?next=` the perimeter does not have |
| Telling a refusal apart from a dead network | **absent** — `useOnlineStatus` (S-01) only knows `navigator.onLine` |

### Key discoveries

- **The gateway's refusal is a 148-byte HTML page, not a status code the app can read
  structurally.** No `Location`, no `WWW-Authenticate`, no CORS, identical for reads,
  writes, streams and deep links. The only two signals available are the status and the
  content type — which is why both live in one place, `src/api/http.ts`.
- **The return target is the path.** `return 302 https://$host$uri` keeps the path and
  drops the entire query string. This is what unblocks FR-005 without touching the
  perimeter: re-path the pasted link to `/m/` and the gateway sends the operator back to
  the app itself.
- **The product must never hold the key**, because the cookie's value *is* the key. It
  lives in component state until submit and in the URL for one navigation; if it comes back
  unconsumed it is stripped from the history entry before first paint.
- **An unreachable Cezar is not a lapsed session.** Conflating them would send an operator
  on a bad connection hunting for an access link they already have. Separate error types,
  separate screens.
- **iOS freezes the app, and the session cookie is unreadable.** So "am I still authorized"
  has exactly one answer — ask — and the app asks again on every return to the foreground.
  That listener is also what makes the fallback unlock path work without a button press.

## Desired End State

Launching the app probes `GET /api/v1/health`. A refusal renders the connect screen, which
takes a pasted access link, keeps only its `key`, rewrites the path to `/m/` and navigates
there in the current context. A gateway that honours the key returns the operator to the
app with a session. A gateway that does not returns them to a screen that says so, with the
secret already gone from the URL and a re-probe waiting on the next foreground. A dead
network says *that* instead. The app chrome — update prompt, offline banner, install hint —
stays reachable in every one of those states.

## What We're NOT Doing

- **No login, and nothing that looks like one.** Cezar ships no authentication; a password
  field here would be theatre.
- **No storing the access link** in `localStorage`, IndexedDB, the query cache, or a log.
- **No "your access expires soon".** The cookie is `HttpOnly` and non-sliding; the product
  cannot see it. The only signal is a refusal, in flight.
- **No sign-out** (FR-006) — that is S-12, and it needs local state and a push subscription
  to tear down before it means anything.
- **No perimeter change.** Whether the `?key=` guard covers `/m/` is the operator's to
  settle; the app works either way.
- **No task data.** Everything behind the gate is still S-03's placeholder.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | HTTP layer that classifies refusal / API error / network failure | `src/api/http.ts`, `src/api/types.local.ts` |
| 2 | Session probe as a query | `src/api/health.ts` |
| 3 | Pure access-link rewriting | `src/domain/access-link.ts` |
| 4 | Navigation and history cleanup | `src/features/auth/unlock.ts` |
| 5 | Session state, re-probed on foreground | `src/features/auth/useSession.ts` |
| 6 | The screens and the gate | `src/features/auth/{ConnectScreen,UnreachableScreen,AuthGate}.tsx`, `src/i18n/pl.ts`, `src/App.tsx` |

## Progress

- [x] **Unit tests** — 100 passing (`npm test`), 44 of them new: the HTTP layer's five
      outcomes, the access-link table, the history strip, the four gate states, and the
      connect screen's validation and secret handling.
- [x] **Typecheck and lint** — `npm run typecheck`, `npm run lint` clean.
- [x] **E2E in WebKit at iPhone dimensions** — 17 passing (`npm run test:e2e`), 7 new: the
      refusal, the authorized pass-through, the unlock navigation (asserting the secret is
      gone from the URL afterwards), the foreign-host refusal, the re-check, the
      unreachable case, and the service worker letting the unlock through to the network.
- [x] **Both themes at 390×844** — `evidence/`.
- [x] **Docs** — `docs/REQUIREMENTS.md` R-AUTH-2/3 (+3a) and § 9 Q1; `docs/CEZAR_API.md`
      § 1a; roadmap Baseline, S-02 and Open Question 1.
- [ ] **On the device, with the real access link** — the one thing no headless browser can
      answer: whether the gateway consumes `?key=` at `/m/`. One paste settles it. If it
      does, FR-005 is closed as written; if it does not, the fallback is what ships and
      FR-005 reads "re-open by hand", with the app already doing the returning.

### Caught in self-review: the worker was eating the unlock

The first version of this change would have made unlocking impossible on exactly the
device it is for. The service worker's navigation fallback answers *any* in-scope
navigation from the precache, so `/m/?key=…` never reached nginx — the gateway cannot set a
cookie for a request it does not see, and the app would have reported "the gateway did not
accept the link" no matter how the gateway was configured. Worse, the fallback path made
the symptom look exactly like the open perimeter question, so it would have been read as
the answer to Q1.

`?key=` is now on the navigation route's denylist (Workbox tests those patterns against
pathname + search), and `test/e2e/connect.spec.ts` asserts it: a plain navigation is served
by the worker, the unlock navigation is not. Verified in both directions — reverting the
denylist entry makes that test fail.

### Incidental fix

`playwright.config.ts` now honours `E2E_PORT`. `reuseExistingServer` had silently reused a
preview server another worktree left on 4173, so the first E2E run tested a build without
this change in it and reported green on four tests that should have failed. A port override
is the cheapest way to make parallel worktrees safe.
