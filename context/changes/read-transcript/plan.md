# Read a task's transcript — Implementation Plan

## Overview

Close roadmap slice **S-05** (`read-transcript`). The operator opens a task and reads its
header: status, workflow, step progress, runner and model, cost, tokens, branch and PR link.
Below it is the most recent stretch of the transcript. Agent messages are formatted text,
tool calls are collapsed to one line and expandable, and the agent's current plan is pinned
above. Opening the task marks it read.

Derived from `context/foundation/roadmap.md` § S-05, PRD US-01, FR-014, FR-015, FR-017,
FR-018, FR-020, and Cezar's cockpit source at `v0.11.0`. See `change.md`.

## Current State Analysis

| S-05 capability | State before this change |
| --- | --- |
| Task screen and route | **absent**. Rows do not navigate, and every deep link redirects to `/`. |
| Run record fetch (`GET /p/:projectId/runs/:id`) | **absent** |
| Transcript page (`/history`, `/history-context`) | **absent**, and not in `docs/CEZAR_API.md` |
| Transcript reducer | **absent** (`src/domain/transcript.ts` is named in CLAUDE.md but does not exist) |
| Markdown rendering | `react-markdown` installed, unused. No GFM. |
| Read receipt (`POST …/read`) | **absent** |

### Key discoveries

- **The history page is not v2-only.** `GET /history` returns the raw persisted lines of the
  newest 100 *canonical items*. Protocol-v2 events (`item.*`, `turn.*`, `plan.updated`) come
  interleaved with their v1 twins (`text`, `tool-call`, `tool-result`), plus v1-only lines
  (`user-message`, `note`, `lifecycle`, `check-output`, `image`). The live capture has both
  kinds for every tool call. A v2-only reducer would lose the user's own messages. A naive
  one would show every tool twice.
- **The cockpit already solved this, so the reducer is a port.** It follows `reduceThread()` in
  `web/src/routes/task-thread/thread-state.ts`, including its dedup rules. Within a turn, v2
  wins for tools. v1 prose is dropped only when a v2 message in the same turn carries the
  same text, with the legacy per-token run repair. The cockpit's ask cards, `CEZ:` marker
  stripping and TodoWrite plan fallback come too. The phone and the laptop must show the same
  transcript for the same task, just as they must agree on attention.
- **The plan can be older than the page.** `plan.updated` has full-replacement semantics, and
  the newest snapshot may sit before the page's first line. `GET /history-context` exists for
  exactly this. It returns the latest plan, turn boundaries and open items. The pinned plan is
  therefore folded from context ∪ page (the cockpit's `currentEvents`). The transcript body is
  folded from the page alone.
- **History carries no `item.delta`.** Deltas are ephemeral and live-stream only. The reducer
  still handles them, because S-06 feeds live events into the same fold.
- **Unknown event types render nothing.** That is the cockpit's choice, and the PRD allows it
  ("renders generically or is skipped"). An `item.*` event whose `kind` is unknown, or which
  has no id, is dropped the same way. Nothing in the fold throws.
- **The read receipt answers with the whole record.** It is written back as `seenAt` only,
  as the cockpit's `useMarkRunSeen` does. Its test shows that writing the snapshot wholesale
  reverts fields the stream advanced meanwhile.
- **Transcript images are not loaded.** The v1 `image` line carries a URL on the legacy
  `/api/runs/…` surface, which rule 2 forbids. It renders as a line pointing to the cockpit.
- **Agent markdown must not load anything.** `react-markdown` never renders raw HTML (there is
  no `rehype-raw`), and its default `urlTransform` drops `javascript:`. Markdown images are
  replaced by their alt text, because an `<img>` pointing wherever the agent chose would be a
  third-party request (PRD: no third-party services). Links open in a new tab with
  `noopener noreferrer`. `remark-gfm` is added for tables and task lists, which agents write
  constantly.

## What We're NOT Doing

- **No live transcript and no resume after suspension** (FR-016, FR-019, FR-021). That is
  S-06. In the interim the run and the page refetch on returning to the app, every 30 s while
  visible, and on the refresh button, exactly as the list did before S-04.
- **No older pages** (FR-049, parked). When the page `hasOlder`, the top of the transcript
  says so and links to the cockpit.
- **No answering and no actions.** Ask cards are read-only (S-07). Cancel, finish and the
  rest are S-08.
- **No diff** (S-09) and **no sub-agent dock.** Sub-agent items nest under their parent tool,
  one level deep, as in the cockpit's `thread-groups.ts`.
- **No syntax highlighting.** That is a PRD non-goal.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | Port the thread reducer, the plan helpers and the footer; add display grouping (plan tools out, sub-agents nested) | `apps/pwa/src/domain/transcript.ts`, `transcript-blocks.ts` |
| 2 | Header display rules: workflow label, step progress, tokens, runner/model, PR link | `apps/pwa/src/domain/run-header.ts` |
| 3 | Fetch run, page, context; the read receipt | `apps/pwa/src/api/run.ts` |
| 4 | Route, screen, header, plan, transcript entries, markdown; rows become links | `apps/pwa/src/main.tsx`, `App.tsx`, `src/features/run/*`, `runs-list/RunRow.tsx`, `i18n/pl.ts` |
| 5 | Contract tests over live captures; E2E in WebKit; docs | `apps/pwa/test/`, `test/e2e/run.spec.ts`, `docs/CEZAR_API.md` |

## Progress

- [x] **Unit + component tests**: 320 passing (`npm test`), 97 of them new. The reducer runs
      on a hand-written NDJSON recording (v1/v2 twins, deltas, unknown types, malformed items,
      ask cards, sub-agents, check steps) and on a live page. Also covered: header rules, the
      read receipt's `seenAt`-only write-back, and the screen's header, plan, tool expansion,
      markdown sanitization, 404 and lapsed-session paths.
- [x] **Contract tests**: the live run, history page and history context validate against the
      vendored schemas, and so does every line of the recording.
- [x] **Typecheck and lint**: `npm run typecheck`, `npm run lint` clean.
- [x] **E2E (WebKit, iPhone 14)**: 30 passing, 7 of them new. A row opens the task. The plan
      stays pinned while scrolling. A tool is one ≥ 44 px line until tapped. No sideways scroll
      with a tool open. The receipt is sent once. A deep link survives a reload and the way
      back works. A lapsed session lands on "Connect to Cezar".
- [x] **Both themes at 390×844**: `evidence/`.
- [x] **Live data**: rendered against the instance's real run and history
      (`evidence/live-dark.png`, `evidence/live-transcript-light.png`), with the receipt blocked
      in the capture. The run's `seenAt` was checked unchanged afterwards.
- [ ] **Manual: on the phone**: open a task from the installed app, from the list and from a
      pasted deep link.

## Found while building

- **`basename="/m"` sent "back to the list" to `/m`, outside the app.** React Router
  resolves a link to `/` to the bare basename. `/m` is outside the service worker's scope and
  outside nginx's `location ^~ /m/`, so a reload there would have reached the gated cockpit.
  The E2E back-link test caught it. The fix is `basename="/m/"`, which still strips correctly
  for `/m/p/…`.
- **A translucent sticky bar is unreadable** over dense transcript text in WebKit
  (`bg-surface/95`). The bar is now opaque.
- The app header stopped being sticky. The task screen pins its own bar (back link and plan),
  and two stacked sticky strips would cost a phone a sixth of its height.
