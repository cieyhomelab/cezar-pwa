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

Prerequisite **F-01** (`serve-shell-at-perimeter`) is in the repo but has never been applied
to the live host: `/m/` still answers 403 from the gate. So the half of S-01 that is
real-device verification cannot run yet. This change delivers the code and the automated
(WebKit) verification; the device checklist stays open and is listed under Manual in
`## Progress`.
