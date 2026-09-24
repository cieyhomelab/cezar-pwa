# Act on a task — Implementation Plan

## Overview

Close roadmap slice **S-08** (`act-on-a-task`). From the task screen the operator can cancel a
running or queued task behind a confirmation, accept and finish a task in review, open a draft
PR for a reviewed task, continue a finished or failed task, and pin or archive a task. Every
action shows it is in flight and, on failure, the reason the server gave.

Derived from `context/foundation/roadmap.md` § S-08, PRD FR-025 to FR-029 and FR-032, and
Cezar's source at `v0.11.0`. See `change.md`.

## Current State Analysis

| S-08 capability | State before this change |
| --- | --- |
| Action policy | **absent**. S-07 had ported `isRunActive` and `lastSessionId` for delivery (`domain/answer.ts`). |
| `POST …/cancel`, `/finish`, `/pr`, `/pin`, `/archive` | **absent** from `src/api/`. `/continue` existed, but only with an opening prompt (S-07). |
| Action UI | **absent**. The header was read-only. |
| Write errors | `http.ts` separates `ApiError`, `AuthRequiredError`, `NetworkError` and `TimeoutError`, and S-07 rendered them for sends. |

### Key discoveries

- **The cockpit has one policy function, and it is small.** `runActionFlags(run)`: cancel while
  the engine owns the run (`running`, `queued`, `waiting`); finish at `waiting` or `review`;
  continue when not active and a session is recorded; archive when not active; pin unless
  archived. `review` is not active: a parked review can be continued or archived like any
  finished run. The phone copies it rather than inventing a second opinion.
- **Finish has two meanings on one endpoint.** At `review` it accepts the changes without a PR
  (FR-026). At `waiting` it closes the session. The cockpit labels them differently, and so does
  the phone ("Accept" / "Finish").
- **Draft PR lives in the review panel, not the header.** It is offered while the run rests at
  `review` and no `http(s)` PR URL is known, because a second tap would open a duplicate. On
  success the server sets `pullRequestUrl` and completes the run as `done`. A run without a
  worktree is a `400`, and a forge failure a `409` with a `manual` merge command. The phone shows
  the reason and drops the command: a `git merge` line is no use on a phone.
- **Cancel can succeed without cancelling.** `{ cancelled: false }` is a 200 for a run that had
  already settled. The operator is told so rather than shown a success.
- **Pin and archive answer with the whole record.** The screen takes only the flag from it, as
  the read receipt does (S-05), and refetches. `runs-index` has `archived` but no `pinned`, so an
  archived row leaves the list at once and a pin has no list effect on the phone (the list has
  no "Pinned" section, S-03).

## What We're NOT Doing

- **No delete.** Not in the PRD. The cockpit's delete removes the worktree and branch with no
  undo, and that belongs on the laptop.
- **No send-back review notes.** The cockpit's review panel can send notes back through
  `/continue`. On the phone, the S-07 composer does not open at `review` (it is not an active
  state), so notes are not offered. Continue reopens the session, and the composer then takes
  the message.
- **No provider-availability pre-check** before continue, as in S-07: the server refuses and the
  phone shows its reason.
- **No runner or model picker** on continue. The run keeps its own engine.
- **No cancelling of a scheduled auto-resume** (FR-030, parked).
- **No unread marker action, terminal hand-off or "open in"**: not in the PRD, and the hand-off
  is disabled in hosted mode anyway.
- **No automatic retry.** A timed-out cancel or draft PR may already have happened.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | The action policy as a pure function, ported from `runActionFlags` plus the review panel's Draft PR gate | `apps/pwa/src/domain/run-actions.ts` |
| 2 | The six writes (20 s timeout, no retry). Pin and archive answers are written into the caches as the flag only | `apps/pwa/src/api/run.ts` |
| 3 | One action at a time: in flight, the failure in words, a notice where the record alone would not say what happened, and the cancel confirmation | `apps/pwa/src/features/run/useRunActions.ts` |
| 4 | The action bar under the header, the inline cancel confirmation (`alertdialog`), and archived/pinned marks in the header | `RunActionBar.tsx`, `RunHeader.tsx`, `RunScreen.tsx`, `i18n/pl.ts` |
| 5 | Table tests, component tests, WebKit E2E, evidence, docs | `run-actions.test.ts`, `RunScreen.actions.test.tsx`, `test/e2e/actions.spec.ts`, `docs/CEZAR_API.md` |

### Design notes

- **The bar waits for a send.** It is disabled while an S-07 send is in flight. A plain
  Continue racing a resumed answer would reach the agent in an order nobody chose. The reverse
  lock (the composer waiting for an action) is not added. Of the actions, only Continue can
  collide with a send, and the composer is closed on every status where Continue is offered,
  unless a question is open.
- **The confirmation is inline, not a modal.** It replaces the bar with an `alertdialog`
  (title, what happens, "Keep" / "Cancel the task"). The first tap only asks. A native
  `<dialog>` adds a focus trap and a backdrop that jsdom cannot drive, and the inline panel keeps
  both buttons under the thumb.
- **Archive stays on the screen.** The task leaves the list, so the screen says where it went
  ("Archived" in the header, plus a notice) and offers "Restore from archive". A mis-tap
  is one tap to undo.

## Progress

- [x] **Unit + component tests**: 492 passing (`npm test`), 30 of them new. The table tests pin
      the action set per status, continue needing a session, no duplicate draft PR, and no pin
      on an archived run. The component tests drive the screen: the action set per status, the
      cancel confirmation (keeping sends nothing, confirming cancels and the refetch shows it),
      the already-settled cancel, accept and the `waiting` finish, a draft PR in flight
      blocking every other action, the forge's refusal verbatim, continue with no body and its
      refusal, pin/unpin bodies and the flip, and archive then restore.
- [x] **Typecheck and lint**: `npm run typecheck`, `npm run lint` clean.
- [x] **E2E (WebKit, iPhone 14)**: 48 passing, 4 of them new. Cancel asks first, then stops the
      task, and the button is ≥ 44 px. Accept is one tap. A refused draft PR shows the forge's
      reason and stays usable. Archive marks the task and restores it. Nothing scrolls sideways.
- [x] **Both themes at 390×844**: `evidence/review-light.png`, `review-dark.png`,
      `confirm-cancel-light.png`, `confirm-cancel-dark.png`, `pr-refused-light.png`,
      `archived-dark.png`.
- [ ] **Manual: on the phone**: accept a real review and cancel a real run from the installed
      app.

## Found while building

- `test/e2e/shell.spec.ts` failed once in the full run: `getByRole('heading', { name: 'Cezar' })`
  also matches "Connect to Cezar" once the health probe answers, and strict mode refuses two
  matches. That is a race that predates S-08, and it passed on rerun. Fixed with
  `exact: true`.
