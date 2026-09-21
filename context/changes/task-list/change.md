---
change_id: task-list
title: Task list across projects, attention first
status: in-progress
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-03** (`context/foundation/roadmap.md`) — the north star. PRD refs US-02,
FR-007, FR-008, FR-009, FR-011, FR-013.

Opened by an implementation run, like the two slices before it: no spec existed for S-03, so
`plan.md` is **derived** from the roadmap slice, the PRD requirements it names, and the
cockpit's own source at the version the instance runs.

## Prerequisites

- **S-02** was merged (PR #12–#14).
- **F-02** was *not* — `packages/cezar-contract/src/` was empty. It is cheap, repo-only and a
  hard prerequisite, so it lands here as its own first commit rather than as a separate
  round trip: vendored at tag `v0.11.0` (`67fc941`), the version `GET /api/v1/health`
  reports on the VPS on 2026-09-21.

## What vendoring changed

`packages/shared/src/attention.ts` had been written from `docs/CEZAR_API.md` and flagged
itself for reconciliation "when the contract is synced". With upstream's source in hand it
became a transcription of `web/src/lib/attention.ts` (different return shape, `failed` before
`waiting` in the ladder, same yes/no answer). Nothing imported the old shape yet, so the
reconciliation cost nothing downstream.

## Evidence

`evidence/` holds WebKit captures at 390×844 (`deviceScaleFactor: 1`): the full list in both
themes, a project filter, a failed refresh keeping its rows under a dated warning, and the
list rendered against the **live** instance's data (dev proxy over loopback, read-only).
