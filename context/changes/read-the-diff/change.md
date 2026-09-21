---
change_id: read-the-diff
title: Read-only diff, file by file
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-09** (`context/foundation/roadmap.md`). PRD ref FR-031: the operator reads a
task's diff, file by file, read-only, with lines wrapped and no syntax highlighting.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md` is
**derived** from the roadmap slice, FR-031, and Cezar's source at `v0.11.0` (`67fc941`, the
version the instance runs). The cockpit side: `packages/web/src/routes/task-git/task-changes.tsx`
(the Changes tab, which forces unified + wrap below `md`) and
`packages/web/src/components/diff/parse-patch.ts`. The server side: the `/runs/:id/diff` and
`/runs/:id/changes` handlers in the installed `dist/server/server.js` and `collectChanges` /
`assemblePayload` in `dist/server/git-changes.js`.

## Prerequisites

- **S-05** was merged (PR #17). S-09 adds a row to its header and a screen under its route.
- **S-08** (PR #20) was merged before this branch started. S-09 does not touch its action bar.

## Evidence

`evidence/` holds WebKit captures at 390×844 (`deviceScaleFactor: 1`). The `header-*`, `files-*`,
`open-*` and `refused-light` captures stub Cezar with the live `/changes` fixture plus two
hand-written files (an image and a deletion). `live-dark.png` is this very task's diff read from
the instance on the VPS through the dev proxy (loopback, GETs only), before it was committed.
