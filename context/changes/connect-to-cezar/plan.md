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
- [x] ~~**On the device, with the real access link**~~ — done 2026-09-21, and it **failed**:
      both `…/m/?key=…` and `…/?key=…` ended in a refusal. See "Found on the device".
- [x] **Fix, rehearsed against real nginx 1.28.3** (the VPS's version) —
      `deploy/nginx/rehearse.sh`: raw key at `/m/` → 302 to `/m/` + cookie, and the session
      opens the gate; re-encoded key and wrong key → shell, no cookie; cockpit still gated.
      Against `main`'s snippet the same script fails on exactly the device's symptom.
- [x] **Installed on the VPS** (2026-09-21). The operator's first run used a stale checkout
      (`762f8fa`) with no unlock step. Reading the host showed the guard lives in
      `snippets/cezar-gate.conf`, not the vhost, so `extract-unlock.sh` now follows the
      vhost's includes (dry-run against the real config first, then installed with the
      previous snippet backed up to `/var/backups/`).
- [x] **Verified on the live gateway** — real key at `/m/` → 302 to `/m/` + `Set-Cookie`;
      wrong key → shell, no cookie; `/` and `/api/v1/health` without a cookie → 403; the
      session from `/m/` opens `/api/v1/health`. In WebKit against the live host, pasting the
      real link lands behind the gate and survives a reload (`evidence/live-unlocked-dark.png`).
- [ ] **One paste on the physical phone** — the only thing a headless browser cannot stand
      in for (the installed app's separate cookie jar).

The real key contains none of `/ + = ~ !`, so the re-encoding defect was real but latent
for it; the guard's placement is what actually blocked the device.

## Found on the device (2026-09-21)

The operator pasted the real link — both the `/m/` and the `/` form — into the installed
app and got a refusal. Three defects, each enough on its own:

1. **The guard is not reached at `/m/`.** Measured without the key: `/m/` answers 200 with
   no cookie, so the gateway's cookie check is not server-level — it sits in
   `location /`, and the `?key=` guard beside it. `location ^~ /m/` never enters that
   block, so `/m/?key=…` just served the shell. Reproduced on a scratch nginx shaped like
   § 1a. Fixed at the perimeter, as the PRD said it would be: the `/m/` snippet includes
   `/etc/nginx/snippets/cezar-mobile-unlock*.conf`, and `install.sh` copies the vhost's
   guard into it on the host (`extract-unlock.sh` — verbatim, mode 600, never printed;
   refuses anything ambiguous rather than guessing). The secret stays out of the repo.
2. **The client re-encoded the key.** `URLSearchParams.set` turns `/`, `=`, `~`, `!` into
   `%2F`, `%3D`…; nginx's `$arg_key = "…"` compares raw bytes. A base64-style key could
   never match, guard or no guard. The key is now spliced in exactly as pasted; tests pin
   it byte-for-byte, in Vitest and in WebKit.
3. **The fallback could not work.** It said "open the link in Safari and come back" — but
   the installed app keeps its own cookies (R-AUTH-1, a fact this repo already recorded),
   so a session opened in Safari never reaches it. The earlier claim that "the app works
   either way" was wrong: in the installed app there was no working path. The advice is
   now shown only in a browser tab, where it is true; the installed app says instead that
   the link is incomplete or the server lacks the `/m/` unlock.

Also re-verified: the live service worker already carries the `?key=` denylist, so the
unlock navigation does reach nginx.

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
