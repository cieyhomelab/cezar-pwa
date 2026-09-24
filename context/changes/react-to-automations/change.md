---
change_id: react-to-automations
title: Pause, enable and run an automation from the phone
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #70, slice **S-20** (second-round roadmap). Allowed by the Non-Goal the operator narrowed
on 2026-09-24 (D07/N05): pause, enable and "run now" are reacting; creating, editing, deleting
and `/check` previews stay in the cockpit. FR-032 for refusals, brief R03 for the confirmation.

There was no spec file; the issue body is the spec. Routes were read from the installed Cezar
`0.11.1` server (`dist/server/server.js`, the automations family) and the vendored contract
(`automationsResponseSchema`, `automationResponseSchema`, `automationRunResponseSchema`,
`automationLogResponseSchema`). The PRD already carried the narrowed non-goal (#73).

## Decisions

- **Run now only for schedule automations.** The server answers `POST …/run` for a GitHub poll
  with `409 a GitHub automation is run through check with mode execute`, and `/check` is out of
  scope (N05). A GitHub row shows Pause/Enable only.
- **Run now sits behind a confirmation; Pause and Enable do not.** Run now launches a task. Enable
  sets a current-time baseline on the server, so it never launches a GitHub backlog.
- **One action at a time across the screen, never retried.** A timed-out Run now may already have
  started a task. After every attempt the list and the log are re-asked, and after Run now the
  task list is too. A successful Run now links to the new task.
- **`available: false` is a note, not an empty screen.** It is the forge's availability, so
  schedules still fire. The reason is shown verbatim and the list stays.
- **Capability off → no requests.** With `health.capabilities.automations` off, every route of
  the family answers 409. The list hides its link, and the screen says automations are off.
- **Next occurrence only while enabled.** The server leaves `nextRunAt` out while paused. The row
  also drops any stale value.
- Refreshed every 30 s and on return to the foreground. Nothing streams automation changes.
- Fixtures are synthetic: both projects on the host have no automations (`automations: []`).

## Evidence

Stubbed API, WebKit iPhone 14 at 390×844, `deviceScaleFactor: 1`:
`evidence/automations-{dark,light}.png`, `evidence/confirm-run-{dark,light}.png`,
`evidence/refused-{dark,light}.png`.
