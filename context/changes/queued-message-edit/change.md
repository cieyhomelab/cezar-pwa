---
change_id: queued-message-edit
title: Edit or remove a queued message
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #66. The composer showed a queued task's `queuedMessages` read-only. There was no spec
file; the issue body is the spec. The routes were read from the installed Cezar `0.11.1` server
(`dist/server/server.js` → `PATCH`/`DELETE /runs/:id/queued-messages/:msgId`,
`dist/workflows/run.js` → `editQueuedMessage()`/`removeQueuedMessage()`) and the vendored
contract (`editQueuedMessageResponseSchema`, `removeQueuedMessageResponseSchema`).

## Decisions

- **Only a queued task's stack can change.** Cezar folds the stack into the prompt at start but
  keeps `queuedMessages` on the record for the life of the run, and both routes answer
  `409 run already started` from then on. After the start the stack stays visible, read-only.
- **Text only.** The PWA sends `{ text }`; attachments on the message are left as they are.
- **Edit follows the composer's rules:** not empty, not unchanged, the draft kept on a refusal,
  the field frozen while the write is in flight.
- **One write at a time**, 20 s timeout, never retried (a timed-out write may have applied).
- **404/409 = already sent.** Cezar's own 404 (message gone from the stack) or 409 (run started)
  reads as a calm status line, not an error, and the record is re-asked. A 404 drops the entry
  from the cache at once. A coded error (no `{ error }` of Cezar's, e.g. nginx's page) is still
  a failure.
- **Cache:** the answer goes into `['run', projectId, runId]` for that one entry
  (`applyQueuedMessage()`); the `run` SSE event carries the whole stack a moment later.

## Evidence

`evidence/` — stack, inline edit, remove confirmation and "already sent" at 390×844, light and
dark (WebKit, `test/e2e/queued-messages.spec.ts` with `E2E_EVIDENCE_DIR`).
