# The transcript stays live and survives suspension — Implementation Plan

## Overview

Close roadmap slice **S-06** (`transcript-stays-live`). The operator watches the transcript
update while the agent works (FR-016). They stay where they scrolled, with a "new messages"
button instead of being pulled to the bottom (FR-019). When they return after the phone froze
the app, nothing is lost and nothing is duplicated (FR-021).

Derived from `context/foundation/roadmap.md` § S-06, PRD US-01, FR-016, FR-019, FR-021, and
Cezar's server and cockpit at `v0.11.0`. See `change.md`.

## Current State Analysis

| S-06 capability | State before this change |
| --- | --- |
| Per-run event stream (`GET …/runs/:id/events`) | **absent**. The task screen refetched every 30 s. |
| Stream manager | S-04's `WorkspaceStream`, hard-wired to the workspace URL and frame names |
| Folding live events | the reducer already handled `item.delta` (S-05 built it for this) |
| Scroll | opened at the newest entry once. Later refetches left the scroll alone. |
| Resume after suspension | a refetch on focus, which replaced the page |

### Key discoveries

- **The stream replays exactly the gap.** `?cursor=<liveCursor>&afterSeq=<n>` replays every
  persisted line after `max(afterSeq, cursor boundary)`, then goes live. Each SSE `id:` is the
  line's `seq`. The cursor is the page's byte offset into the file, so the server reads only the
  tail. The cockpit connects exactly this way, with `afterSeq` set to the highest seq it has.
- **v1 and v2 ride different names.** `ui-event` carries dotted v2 types, `run-event` carries v1.
  The history page holds both, and the reducer dedupes them, so the stream subscribes to both.
  `run` carries the whole record after every change and once after the replay.
- **Deltas carry a `seq` but are never replayed.** `item.delta` is coalesced every ~40 ms onto
  the live wire only (`ui-event-sink.js`). Any sent while the phone was frozen are gone for good.
  An answer caught mid-stream would go on growing from the wrong place, its middle missing, until
  `item.completed` repaired it. So a delta is only applied to an item whose latest snapshot came
  after the current connection's starting point. A caught item keeps the text it had until its
  next snapshot makes it whole. It is never garbled.
- **Dedup by seq is needed, not just by item id.** v2 items upsert by id in the fold, so a
  replayed v2 line is harmless. v1 lines (`user-message`, `note`) have no id: a replayed one
  would open a second turn or repeat a note. The page's `asOfSeq` is the high-water mark, and
  every line at or below it is dropped. The deliberate-break check showed that only the v1 test
  catches this.
- **A refetch in flight can undo the stream.** It is the same race as the list's
  `FrameJournal`: a page computed before a line arrived would erase that line when it lands. The
  history query function replays the cached lines past the fresh page's `asOfSeq` onto it
  (`carryOver`).
- **WebKit dispatches `scroll` events with the next frame.** A line that landed right after a
  programmatic or momentum scroll was judged against a stale "at the bottom", and the screen
  followed a reader who had scrolled away. The E2E test caught it. Whether the reader was at the
  end is now measured synchronously, against the content height from before the change.

## What We're NOT Doing

- **No older pages** (FR-049, parked). The live page only grows downward.
- **No compaction.** Deltas merge into one line per item and field, and a snapshot removes its
  item's deltas, so the page grows with the persisted file, not with the token rate. A session
  would need thousands of persisted lines on one screen before this mattered. The cockpit
  compacts after 5,000.
- **No answering and no actions.** Those are S-07 and S-08.
- **No throttled render.** The cockpit batches renders every 120 ms. Deltas already arrive
  coalesced to ~40 ms, and the fold over one page stayed well inside a frame in WebKit.

## Design

- `src/api/live-stream.ts`: S-04's state machine (backoff, watchdog, `connecting | live |
  reconnecting | lost`), now taking `url()` and `frameTypes`. It also holds `bindLifecycle`,
  which closes the stream on hidden and reopens it on visible. That reopen *is* the resume after
  a suspension. `WorkspaceStream` is a subclass. `reprobeSession` moved to `api/health.ts` and is
  shared.
- `src/api/run-events.ts`: the URL (`cursor` + `afterSeq`) and the frame names.
- `src/domain/live-transcript.ts`: pure. `appendLiveEvent(page, event, boundary)` handles the
  dedup, the gap rule for deltas, delta merging and snapshot supersession. `carryOver(fresh,
  previous)` handles a refetch landing. `transcriptSignature` changes when words change, not when
  a status flip re-folds the same words.
- `src/features/run/useLiveTranscript.ts` writes lines into `['history', …]` and `run` frames
  into `['run', …]` and the list's row, all through `setQueryData`. Every connect asks for
  `afterSeq = page.asOfSeq`. After an attempt that never opened, it connects without the cursor:
  a cursor the server rejects (409) fails every attempt, and EventSource cannot say why.
- `src/features/run/useFollowBottom.ts` follows only while the reader is within 96 px of the
  end. Otherwise it raises `unseen`, which shows the "Nowe wiadomości ↓" button.
- Refetching: while live, the record is polled every 5 min as a safety net, and the page and
  context are not refetched at all. The replay covers them. While not live, S-05's 30 s polling
  and focus refetch apply as before.
- The status line under the header is the S-04 `ConnectionStatus` (word and glyph, never
  colour alone). When not live, it says how old the screen is ("stan z HH:MM").

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | Pure append, dedup, gap rule, carry-over, signature, with table tests | `src/domain/live-transcript.ts` |
| 2 | Generalize the stream manager, add the run stream URL | `src/api/live-stream.ts`, `workspace-events.ts`, `run-events.ts`, `health.ts` |
| 3 | Hook, live-aware query options, follow-bottom, wire into the screen | `src/features/run/*`, `src/api/run.ts`, `src/i18n/pl.ts` |
| 4 | Component tests with a fake EventSource; WebKit E2E; docs | `RunScreen.live.test.tsx`, `test/e2e/live-transcript.spec.ts`, `docs/CEZAR_API.md` |

## Progress

- [x] **Unit and component tests**: 401 passing (`npm test`), 33 of them new. The append table
      covers dedup at and below the mark, delta merge, field separation, snapshot supersession,
      the gap rule both ways, malformed and unknown lines, carry-over and the signature. On the
      screen: the connect URL, streaming word by word without a refetch, v1 lines, replayed lines
      shown once, `run` frames, unreadable frames, hidden to visible resuming from the advanced
      mark, a mid-stream answer across a gap, and dropping the cursor after a failed attempt.
- [x] **Deliberate-break check**: disabling the seq dedup fails 2 screen tests. Disabling the gap
      rule fails the mid-stream test.
- [x] **Typecheck and lint**: `npm run typecheck`, `npm run lint` clean.
- [x] **E2E (WebKit, iPhone 14)**: 40 passing, 3 of them new, on the browser's real
      `EventSource`. An answer streams in within the 2 s NF and the screen follows it. Scrolled
      up, the screen does not move, and a ≥ 44 px "Nowe wiadomości" button appears and takes the
      reader to the end. A dropped stream reconnects with `afterSeq` at the last line, and an
      overlapping replay shows nothing twice. `run.spec.ts` now holds the stream silent.
- [x] **Both themes at 390×844, live data**: `evidence/` shows this task's own run streaming
      from the instance.
- [ ] **Manual: on the phone**: lock the phone mid-answer, unlock after a minute, and check the
      transcript resumes with nothing missing or repeated.

## Found while building

- **WebKit's late `scroll` event** (see Key discoveries). The first version decided "at the
  bottom" from the scroll listener alone.
- **A sibling task's preview server held the E2E port.** `E2E_PORT=4392` silently reused another
  worktree's `vite preview`, and the run tested that branch's build. This is the trap
  `playwright.config.ts` warns about. Pick a port nobody else is on.
