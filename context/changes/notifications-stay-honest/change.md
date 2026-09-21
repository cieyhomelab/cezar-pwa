---
change_id: notifications-stay-honest
title: No duplicate notifications; drop dead destinations
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-11** (`context/foundation/roadmap.md`). PRD refs FR-039, FR-044.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md` is
**derived** from the roadmap slice, the PRD, `docs/REQUIREMENTS.md` F-PUSH-7 / F-PUSH-9, and what
S-10 (PR #22) had already put in place. Most of the rule landed with S-10, because the sidecar
needed it to be safe at all. This change closes the gaps that were left and proves the rest holds.

## Prerequisites

- **S-10** (PR #22): the sidecar, the service worker's push handlers and Settings exist.

## Evidence

No screen changed, so there are no screenshots. The evidence is in the tests (see `plan.md` →
Progress). The device checks wait for the sidecar to be installed on the VPS.
