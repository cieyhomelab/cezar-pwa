---
change_id: live-status
title: Live status updates and connection health
status: in-progress
created: 2026-09-21
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-04** (`context/foundation/roadmap.md`). PRD refs US-02, FR-010, FR-012,
and the NF "a status change on the server is visible in the app within 2 seconds".

Opened by an implementation run, like the slices before it: no spec existed for S-04, so
`plan.md` is **derived** from the roadmap slice, the PRD requirements it names, and Cezar's
server source at `v0.11.0` — read from the package the instance actually runs
(`/usr/lib/node_modules/cezar-cli/node_modules/@open-mercato/cezar/dist/server/server.js`),
not from `docs/CEZAR_API.md`, which had the frame shapes slightly wrong (see plan § Key
discoveries).

## Prerequisites

- **S-03** merged (PR #15): the list, its `['runs-index']` cache and its 30 s interval refetch
  are what this slice makes live.
