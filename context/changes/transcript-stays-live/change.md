---
change_id: transcript-stays-live
title: Live transcript that survives suspension
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-06** (`context/foundation/roadmap.md`). PRD refs US-01, FR-016, FR-019,
FR-021.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md`
is **derived** from the roadmap slice, the PRD requirements it names, Cezar's server at
`v0.11.0` (the `/runs/:id/events` handler and the delta sink, read from the package the
instance runs: `dist/server/server.js`, `dist/runs/ui-event-sink.js`, `dist/runs/store.js`) and
the cockpit's own run-stream hook in the shipped bundle (`web/dist/assets/task-thread-*.js`).

## Prerequisites

- **S-04** (PR #16): the stream manager, its backoff, watchdog and states. Generalized here into
  `api/live-stream.ts`; the workspace stream is now a thin subclass.
- **S-05** (PR #17): the task screen, the history page in `['history', …]` and the transcript
  reducer, which already handled `item.delta` for this slice.

## Evidence

`evidence/` holds WebKit captures at 390×844 (`deviceScaleFactor: 1`) against the instance's
real stream over loopback (GETs only, read receipt blocked). The subject is this task's own run,
which was writing while it was captured.
