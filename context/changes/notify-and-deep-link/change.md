---
change_id: notify-and-deep-link
title: Notify on a locked phone and deep-link to the task
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-10** (`context/foundation/roadmap.md`). PRD refs US-01, FR-036, FR-037, FR-038,
FR-041, FR-043. FR-045 (test notification, parked) is folded in, as the roadmap allowed, because it
is how the device pass checks the chain.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md` is
**derived** from the roadmap slice, the PRD, `docs/REQUIREMENTS.md` § 4.5 and § 6, and Cezar's
source at `v0.11.0` (`67fc941`): `packages/web/src/lib/notifications.ts` (the cockpit's own
notification rule, ported) and the workspace stream in the installed `dist/server/server.js`.

## Prerequisites

- **F-01** is live: `/m/` is served outside the gate. S-10 adds `/m/push/` beside it, **inside** the
  gate.
- **S-05** (PR #17): the task screen the notification opens exists at `/m/p/:projectId/runs/:runId`.

## Evidence

`evidence/` holds WebKit captures at 390×844 (`deviceScaleFactor: 1`), both themes: Settings in a
browser tab (`tab-install-*`), installed with notifications off (`off-*`), and on, after a test
(`on-*`). The installed states stub the Push API in the page, since WebKit under Playwright has none.
The sidecar also ran against the live instance on loopback (see `plan.md` → Progress).
