---
change_id: new-task
title: Start a new task from the phone
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #62, slice **S-13** (second-round roadmap). PRD refs FR-033, FR-034, with FR-032 for refusals.

There was no spec file; the issue body is the spec. Routes were checked against the live host
(Cezar `0.11.0`) before building. One finding: `docs/CEZAR_API.md` listed
`GET /api/v1/p/:projectId/models`, which answers 404. The model catalog is the workspace route
`GET /api/v1/models?runner=…`, and the doc now says so.

## Decisions

- **Entry:** a "New task" button on the list. A list filtered to one project passes
  `?project=<id>` so the form starts in that project.
- **Defaults follow the cockpit:** `quick-task`, the project's `defaultRunner` (only if installed),
  and the project's model preset (only if the catalog offers it). Anything else is "Auto" and is
  left out of the body.
- **Hidden when empty:** the account picker (no profiles on this host) and the model picker under
  `modelsLocked`.
- **Not retried:** a timed-out create may already have started a task.
- The contract's `runnerDiscoversModels` is not imported, because that would bundle zod. The list
  lives in `domain/new-task.ts` with a `satisfies` check against the contract's enum.

## Evidence

- `evidence/new-task-{light,dark}.png`: the form at 390×844 after a refusal, from the WebKit E2E.
- `evidence/landed-on-dry-run-task.png`: the unstubbed form against a local `CEZ_DRY_RUN=1` Cezar
  created run `0e3e1fee…` and landed on `/m/p/repo/runs/0e3e1fee…`. The same run showed a real
  `400 unknown workflow: no-such-workflow` verbatim, and the description stayed in the field.
