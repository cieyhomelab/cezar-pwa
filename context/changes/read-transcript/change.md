---
change_id: read-transcript
title: Task header and most recent transcript
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-05** (`context/foundation/roadmap.md`). PRD refs US-01, FR-014, FR-015,
FR-017, FR-018, FR-020.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md`
is **derived** from the roadmap slice, the PRD requirements it names, and the cockpit's own
source at `v0.11.0` (`67fc941`, the version the instance runs). The main source is
`packages/web/src/routes/task-thread/` and `api/run-history.ts`.

## Prerequisites

- **S-03** and **F-02** were merged (PR #15).
- **S-04** (PR #16) is open in parallel. The two touch different screens. They meet only in
  `RunRow.tsx` (the row becomes a link here), `RunsListScreen.tsx` (no change here) and
  `i18n/pl.ts` (separate sections).

## Evidence

`evidence/` holds WebKit captures at 390×844 (`deviceScaleFactor: 1`). The live ones were
taken against the instance's real data through the dev proxy over loopback, with GETs only
and the read receipt blocked, so the capture did not mark anything read.
