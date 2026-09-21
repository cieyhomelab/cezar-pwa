---
change_id: settings-and-sign-out
title: Theme, versions, cockpit link, sign-out
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-12** (`context/foundation/roadmap.md`), the last slice. PRD refs FR-006, FR-046,
FR-047, FR-048.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md` is
**derived** from the roadmap slice, the PRD, `docs/REQUIREMENTS.md` § 4.7, the cockpit's routes at
`v0.11.0` (`packages/web/src/routes.tsx`: a task is `/p/:projectId/tasks/:id`, its diff `…/changes`)
and the live gate (`/etc/nginx/snippets/cezar-gate.conf`, read on the host).

## Prerequisites

- **S-03** (PR #15): the session probe and the list the sign-out lands back on.
- **S-10** (PR #22): the Settings screen and the push subscription the sign-out tears down.

## Evidence

`evidence/` holds WebKit captures at 390×844, both themes: Settings as it opens (`settings-*`), the
sign-out confirmation (`sign-out-confirm-*`), a theme forced against the system
(`forced-light-on-dark-system`, `forced-dark-on-light-system`), and a task's top bar with the
cockpit link (`task-cockpit-link-*`). They are browser-tab captures, so the install hint shows. The
perimeter half was rehearsed with `deploy/nginx/rehearse.sh` and dry-run against the live gate (see
`plan.md` → Progress).
