---
change_id: answer-the-agent
title: Answer a question or message a task
status: implemented
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-07** (`context/foundation/roadmap.md`). PRD refs US-01, FR-022, FR-023,
FR-032.

Opened by an implementation run, like the slices before it. There was no spec, so `plan.md`
is **derived** from the roadmap slice, the PRD requirements it names, and the cockpit's own
source at `v0.11.0` (`67fc941`, the version the instance runs). The main sources are
`packages/web/src/routes/task-thread/ask-answer.ts`, `ask-card.tsx`, `run-actions.ts`, the
composer routing in `task-thread.tsx`, and the server's `POST /runs/:id/messages` and
`/continue` handlers in `packages/cezar/src/server/server.ts`.

## Prerequisites

- **S-05** was merged (PR #17). S-07 builds on its task screen, its transcript reducer (which
  already produced ask cards and resolved them on the next message) and its query keys.
- **S-06** (`transcript-stays-live`) is being built in parallel on `cez/96cc0016`. The two
  meet in `features/run/RunScreen.tsx`, `TranscriptView.tsx` and `i18n/pl.ts`. S-07 does not
  change how the transcript is fetched. After a send it only invalidates the run, history and
  index queries, which also works with a live stream.

## Evidence

`evidence/` holds WebKit captures at 390×844 (`deviceScaleFactor: 1`), both themes, with Cezar
stubbed. No live run held an open question, and a send to a live run would reach a real
agent, so nothing was posted to the instance.
