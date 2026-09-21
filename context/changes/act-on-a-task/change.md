---
change_id: act-on-a-task
title: Cancel, finish, continue, draft PR, pin, archive
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-08** (`context/foundation/roadmap.md`). PRD refs FR-025, FR-026, FR-027,
FR-028, FR-029, with FR-032 (in flight, and the server's reason on failure) applying to every
action.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md`
is **derived** from the roadmap slice, the PRD requirements it names, and Cezar's source at
`v0.11.0` (`67fc941`, the version the instance runs). The cockpit side:
`packages/web/src/routes/task-thread/run-actions.ts` (`runActionFlags`), `run-header.tsx`
(the action bar and the cancel confirmation), `review-panel.tsx` (Accept and Draft PR) and
`use-finish-run.ts`. The server side: the `/cancel`, `/finish`, `/continue`, `/pr`, `/pin` and
`/archive` handlers in the installed `dist/server/server.js`.

## Prerequisites

- **S-05** was merged (PR #17). S-08 adds a bar under its header.
- **S-06** (PR #19) and **S-07** (PR #18) were merged before this branch started. S-08 shares
  S-07's write timeout, its invalidation after a write, and its rule that a timed-out write is
  reported, never resent.

## Evidence

`evidence/` holds WebKit captures at 390×844 (`deviceScaleFactor: 1`), both themes, with Cezar
stubbed. Nothing was sent to the instance: every one of these actions stops a real agent,
closes a real session or pushes to a real forge.
