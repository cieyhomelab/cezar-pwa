---
change_id: install-to-home-screen
title: Install to the home screen, run offline, and update on purpose
status: in-progress
created: 2026-09-20
updated: 2026-09-20
archived_at: null
---

## Notes

Roadmap slice **S-01** (`context/foundation/roadmap.md`), PRD refs FR-001, FR-002, FR-003.

This folder was opened by an implementation run, not by `/10x-new` + `/10x-plan`. No spec
existed for S-01, so `plan.md` here is **derived** from the roadmap slice and the three PRD
requirements it names rather than authored by a planning pass. Nothing in it is invented
scope — every phase traces to a sentence in one of those two documents.

Merged as `5606360` on 2026-09-20 (PR #10) and deployed.

**Correction.** This file first said F-01 (`serve-shell-at-perimeter`) had never been applied
and `/m/` still answered 403 — taken from the roadmap's Baseline without re-checking, and
repeated on the PR. Measured after the deploy, `/m/` answers **200 without a session** while
the cockpit `/` answers 403, which is exactly what F-01 requires. F-01 is applied, and the
roadmap's Baseline section is stale on this point.

So the live host was verifiable after all, and was: see `plan.md` § Progress. What is still
open needs a physical iPhone — the Share sheet, a real home-screen launcher, Airplane Mode —
plus one follow-up deploy to watch the update prompt fire against an already-open client.
