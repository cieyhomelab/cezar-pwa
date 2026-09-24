# Live status — Implementation Plan

## Overview

Close roadmap slice **S-04** (`live-status`): status changes appear in the task list without
refreshing and without the list jumping, and the operator can tell whether the live
connection is healthy, reconnecting, or lost.

Derived from `context/foundation/roadmap.md` § S-04, PRD US-02 (acceptance: "the
live-connection state is visible, so a stale list is never mistaken for a quiet one"),
FR-010, FR-012, the 2-second NF, and Cezar's server at `v0.11.0`.

## Current State Analysis

| S-04 capability | State before this change |
| --- | --- |
| Workspace event stream | **absent** — no SSE client anywhere |
| Merging a changed run into the list | **absent** — the list only changes on a refetch |
| Connection health | **absent** — `useOnlineStatus` (`navigator.onLine`) is explicitly not it |
| Freshness | "Zaktualizowano HH:MM" from `dataUpdatedAt`; 30 s interval refetch |

### Key discoveries

- **The stream is `GET /api/v1/workspace/events`**, workspace-level, no `/p/:projectId/`
  variant (like `runs-index`). Read from `server.js` and captured live over loopback.
- **Frames are stamped with `project`, not `projectId`.** `run` = the full `RunRecord` plus
  `project`; `run-deleted` = `{ id, project }`; `usage` = `{ project, usage }`; `todos` =
  `{ project, items }`. `docs/CEZAR_API.md` § 3a said `{ id, projectId }` — corrected there.
- **`ping` every 15 s** is the only heartbeat; `usage` ticks every ~2 s but only while some
  run has a live process. No `id:` lines, so **no replay** — a reconnect must refetch.
- **The index row is a projection of the record** (`runIndexEntry()` in `server.js`), so a
  `run` frame can be turned into exactly the row `runs-index` would have served.
- **A refetch in flight can overwrite a newer frame.** The response is computed server-side
  before a frame that arrives while it travels; landing it would silently undo that frame —
  the "stale status presented as current" failure. Frames received during a fetch are
  therefore replayed onto its result (full-record upserts are idempotent, order is kept).
- **EventSource hides the HTTP status.** A lapsed session (bare 403) looks like any error, so
  every drop asks the health probe, and a refusal hands the screen to `AuthGate`.
- **Safari has no CSS scroll anchoring** worth relying on, so "without the list jumping" is
  done by hand: the first visible row is pinned across an update while scrolled.

## What We're NOT Doing

- **No per-run stream** (`/runs/:id/events`) — that is S-06.
- **No live `usage`** — the row does not show CPU/RSS, so the 2 s ticks are counted as
  liveness and otherwise ignored (no re-render every 2 s).
- **No `todos`, `provider-status`, `automation-change`, `checkout-progress`** — nothing on the
  phone shows them.
- **No highlight animation on changed rows** — the in-place update plus anchoring is the
  requirement; decoration can come later.
- **No WebSocket** — it does not pass the gate (`docs/CEZAR_API.md` § 3d).

## Design

- `src/domain/live-index.ts` — pure: `toIndexEntry(project, record)` (mirror of the server's
  projection) and `applyWorkspaceFrame(index, frame)` → same object when nothing changed.
  Unknown frame types and malformed payloads return the index unchanged (rule 5).
- `src/api/workspace-events.ts` — `WorkspaceStream`: one `EventSource`, its own backoff
  (1 s, 2 s, 5 s, 10 s, 30 s) instead of the browser's, a 45 s watchdog (three missed pings,
  or a connect that never opens), and a state: `connecting | live | reconnecting | lost`
  (`lost` after 20 s without a connection, or at once when the browser says offline).
  Plus the replay journal the runs-index query function uses.
- `src/features/runs-list/useLiveRuns.ts` — wires the stream to the query cache: frames →
  `setQueryData(['runs-index'])`; every (re)open → refetch (no replay); every drop → probe
  health, handing the answer to the session query only when it is a refusal;
  `project-added/removed` → refetch health and the index; closes on hidden and reopens on
  visible (iOS freezes the app). Returns `{ state, liveSince, liveUntil }`: the list is
  current only while live *and* after a fetch landed past `liveSince`; otherwise it is as old
  as the later of its last fetch and `liveUntil` (the last frame before it stopped being live).
- List polling: 30 s while not live (the fallback it always was), 5 min while live (a safety
  net for anything the stream cannot carry).
- `ConnectionStatus` in the list header: word + dot for each state (never colour alone);
  when not live it keeps saying how old the list is.
- `useScrollAnchor` — pins the first visible row across a data change while scrolled.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | Frame merge, table tests; live fixture of the stream | `src/domain/live-index.ts`, `test/fixtures/workspace-events.live-0.11.0.txt` |
| 2 | Stream manager, journal; tests with a fake EventSource and fake timers | `src/api/workspace-events.ts`, `src/api/runs-index.ts` |
| 3 | Hook, indicator, anchoring; wire into the list | `src/features/runs-list/*`, `src/i18n/pl.ts` |
| 4 | E2E in WebKit; screenshots; docs | `test/e2e/live-status.spec.ts`, `docs/CEZAR_API.md` |

## Progress

- [x] **Unit + component tests** — 271 passing (`npm test`), 48 of them new: the frame merge
      table (upsert, insert, delete, unchanged-returns-same-object, unknown and malformed
      frames), the stream's state machine under fake timers (backoff, watchdog, lost, offline,
      stop/start), the replay journal, and the screen going live, reconnecting, lost, hidden
      and back, refusing to say "live" before the gap-filling fetch lands, and a drop's session
      probe that hands on a refusal but not a network error.
- [x] **Contract tests** — the live stream capture and a live run record, stamped as the
      server stamps it, validate against the vendored schemas; the projected row passes
      `runIndexEntrySchema.strict()`.
- [x] **Typecheck and lint** — `npm run typecheck`, `npm run lint` clean.
- [x] **E2E (WebKit, iPhone 14)** — 30 passing, 7 new, on the browser's real `EventSource`:
      a status change within the 2 s NF, reconnecting after the stream ends, a refetch per
      reconnect, a lapsed session caught by a drop, lost on offline, and the scroll anchor
      with native anchoring off (the hook alone holds the row; without it the row moves
      95 px) and on (no double correction).
- [x] **Both themes at 390×844** — `evidence/`: `live-dark.png`, `live-light.png` (the real
      instance), `reconnecting-light.png`, `lost-dark.png` (fixture).
- [x] **Live stream against the instance** — dev proxy over loopback (read-only): live in
      ~0.7–0.9 s, six runs out of six. That check caught a real race: `liveSince` was stamped
      inside a state updater, so a fast refetch could land "before" it and the list said "live"
      while still showing its age. Fixed in `useLiveRuns.ts`. No `run` frame arrived in a
      15-minute capture (records change at turn and step boundaries), so the run-frame shape
      is covered by the server source and the live record fixture, not by a captured frame.
- [ ] **Manual: on the phone** — the indicator across a lock/unlock and Airplane Mode, and a
      status flip from the cockpit arriving on the installed app.

## Found while implementing

- **The existing lapsed-session E2E (`task-list.spec.ts`) raced the new stream.** Unrouted,
      the stream reached the real gateway through the preview proxy, was refused, and its
      drop re-probed the session, which could reach "Connect to Cezar" before the test clicked
      Refresh. The app was right; the test now holds the stream silent.
- **Re-probing the session on every drop could blank the list.** Invalidating the health query
      on a drop let a network blip fail it, and `AuthGate` then swaps the whole list for
      "unreachable" — the opposite of S-03's failed-refresh behaviour. Found in self-review;
      the drop now probes directly and hands the answer on only when it is a refusal.
- **Playwright's WebKit anchors scroll natively**; iOS Safari's support is not something to
      rely on, so the hook stays and the E2E tests both ways.
