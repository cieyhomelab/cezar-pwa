---
change_id: pick-a-variant
title: Keep one variant of a task
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #71, slice **S-21** (second-round roadmap). Allowed by the Non-Goal the operator narrowed
on 2026-09-24 (D07/N07): keeping one variant is in, side-by-side diff comparison stays out.
FR-032 for refusals.

There was no spec file; the issue body is the spec. Routes were read from the installed Cezar
`0.11.1` server (`groups/:groupId`, `groups/:groupId/pick`) and the vendored contract
(`groupResponseSchema`, `pickVariantResponseSchema`).

## Decisions

- **Siblings come from the group route, not the runs index.** The issue asked for grouping "by
  `groupId` from the runs index", but `runs-index` does not carry `groupId` (`docs/CEZAR_API.md`
  already said so). The task screen reads `groupId` from its own record and asks
  `GET /groups/:groupId`, which is what the cockpit's compare view reads. The unit tests cover the
  rows built from that answer (`domain/variants.ts`).
- **Change count = the `N files changed` line of the group's `diffStat` text.** Per-variant
  `/changes` would be one extra request per sibling. `''` (worktree gone) reads "changes
  unknown", never zero.
- **When "Keep this one" shows:** the current variant is not archived and at least one sibling is
  not archived. An active variant (`running | queued | waiting`) shows a "can be kept once it has
  finished" line instead, because the server answers 409.
- **Not retried:** a timed-out pick may already have archived the others. After every attempt the
  group, every run of the project, the history and the list are invalidated.
- Fixtures are synthetic: no run on the host carries a `groupId`.

## Evidence

Stubbed API, WebKit iPhone 14 at 390×844, `deviceScaleFactor: 1`: `evidence/variants-{dark,light}.png`,
`evidence/confirm-{dark,light}.png`, `evidence/refused-light.png`.
