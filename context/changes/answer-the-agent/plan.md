# Answer the agent — Implementation Plan

## Overview

Close roadmap slice **S-07** (`answer-the-agent`). The operator answers an agent's question by
picking from the offered options or writing their own answer. They can also send free text to
a running or waiting task. Every send shows it is in flight and, on failure, the reason the
server gave.

Derived from `context/foundation/roadmap.md` § S-07, PRD US-01, FR-022, FR-023, FR-032, and
Cezar's cockpit source at `v0.11.0`. See `change.md`.

## Current State Analysis

| S-07 capability | State before this change |
| --- | --- |
| Ask card | **read-only**. The S-05 reducer builds it from `ask.requested` and resolves it on the next `user-message`. |
| `POST …/messages`, `POST …/continue` | **absent** from `src/api/`. `docs/CEZAR_API.md` listed the paths but not the answer shapes. |
| Composer | **absent** |
| Write errors | `http.ts` already separates `ApiError` (Cezar's own `{error}`), `AuthRequiredError`, `NetworkError` and `TimeoutError`. Nothing rendered them for a write yet. |

### Key discoveries

- **An answer is just a message.** The cockpit posts one combined user message,
  `"<header>: <labels>"`, one line per question. The reducer resolves the whole card on the
  next `user-message`. So a free-text reply also answers the question, and the phone must use
  the same format or the agent reads two different kinds of reply.
- **A question outlives its session.** The cockpit's `useAskAnswer` sends through `/messages`
  while the run is active (`running`, `waiting`, `queued`). Once the session has closed and a
  session id was recorded, the answer becomes the opening prompt of `POST /continue`. A `409`
  from `/messages` means the cached record was stale, so the answer is resumed rather than
  dropped. The single retry is for `409 run is still active`, the idle-teardown race, on
  upstream's schedule.
- **`/messages` has three success shapes** (#472): `delivered`, `queued` (folded into a queued
  run's prompt, stored in `queuedMessages[]` on the record, not in history), and `deferred`
  (buffered until a starting session opens). Only `deferred` needs a word to the operator. A
  queued message shows up in the record's stack after the refetch.
- **Only the newest question is live.** The reducer tracks one pending ask. An older question
  left unanswered can never resolve, so showing its options would invite an answer to the
  wrong question.

## What We're NOT Doing

- **No plain Continue, Cancel or Finish.** A closed task gets the composer only while an
  unanswered question can reopen it. Continuing a finished task is FR-028, in S-08.
- **No attachments.** Camera photos were cut (was FR-024). The composer is text only.
- **No runner or model picker** on a resume. The server keeps the run's own engine, exactly as
  the cockpit's ask card does.
- **No provider-availability pre-check.** The cockpit reads provider status before offering a
  send. The phone lets the server refuse, and shows its reason (FR-032). That costs one round
  trip and keeps a Settings surface out of this slice.
- **No automatic resend** of a timed-out write. It may already have reached the agent.
- **No persisted draft.** The draft lives while the screen is open, and a failure keeps it.
- **No editing of queued messages.** The cockpit can edit and delete them. The phone lists them.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | Delivery rules as pure functions: active states, last session, delivery mode, when the composer opens, the open question, answer formatting, the idle-teardown retry | `apps/pwa/src/domain/answer.ts` |
| 2 | `POST …/messages`, `POST …/continue` (20 s timeout), invalidation after a write | `apps/pwa/src/api/run.ts` |
| 3 | One shared delivery per screen (in flight, failure in words, `deferred` notice, locally answered ask) | `apps/pwa/src/features/run/useDeliver.ts` |
| 4 | Interactive ask card; docked composer with the queued stack; wiring | `AskCard.tsx`, `Composer.tsx`, `TranscriptView.tsx`, `RunScreen.tsx`, `i18n/pl.ts` |
| 5 | Table tests, component tests, WebKit E2E, evidence, docs | `answer.test.ts`, `RunScreen.answer.test.tsx`, `test/e2e/answer.spec.ts`, `docs/CEZAR_API.md` |

## Progress

- [x] **Unit + component tests**: 430 passing (`npm test`), 62 of them new. The table tests pin
      the delivery mode and composer rule per status, the answer format, the open-question
      rule and the retry schedule. The component tests drive the screen end to end: one-tap
      answer, then resolution after the refetch. They cover the combined multi-question send,
      the in-flight state blocking a second send, and Cezar's reason on a refusal. Also
      covered: the stale-record 409 becoming a resume, a closed question reopening the
      session, the inert card when there is no session, a superseded question, the composer
      keeping the draft on failure, a queued task's stack, the `deferred` notice, and no
      composer on closed tasks.
- [x] **Typecheck and lint**: `npm run typecheck`, `npm run lint` clean.
- [x] **E2E (WebKit, iPhone 14)**: 41 passing, 4 of them new. One tap answers and the card
      resolves. Options are ≥ 44 px. A refusal shows the server's words and the options stay
      usable. The composer is docked at the bottom, its field is ≥ 16 px (no iOS zoom), and it
      sends and clears. A closed task has no composer. Nothing scrolls sideways.
- [x] **Both themes at 390×844**: `evidence/ask-dark.png`, `ask-light.png`,
      `multi-light.png`, `refused-dark.png`, `answered-light.png`.
- [ ] **Manual: on the phone**: answer a real question from the installed app, and check the
      keyboard does not cover the composer.

## Found while building

- The first capture of the refusal showed "session expired", not the server's reason. The
  capture script served a 409 from `/messages` on a run with a recorded session. The client
  correctly fell back to `/continue`, which the script had not routed. The behaviour was
  right and the stub was wrong. It is the case the component test "a stale live record"
  covers.
