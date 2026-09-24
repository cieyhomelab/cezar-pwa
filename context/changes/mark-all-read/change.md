---
change_id: mark-all-read
title: Mark all shown tasks read
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #67. Clears FR-020's unread markers in bulk, respecting the project filter (FR-013). There
was no spec file; the issue body is the spec. The route was read from the installed Cezar `0.11.1`
server (`dist/server/server.js` → `POST /runs/read-all`, `dist/runs/store.js` → `markAllRead()`)
and the vendored contract (`markAllReadResponseSchema`).

## Decisions

- **The rows on screen choose the projects.** Cezar's sweep has no filter; the phone calls it
  once per project that has an unread row in view (`domain/read-all.ts`). A filtered list never
  touches the projects it hides, and a project with nothing unread is not called.
- **The sweep reaches the whole project**, including unread tasks older than the index's
  per-project limit. The confirmation says so. The server's unread rule is a clause-for-clause
  copy of `isUnread`, so nothing the list shows as needing the operator is touched.
- **The plan is frozen at the first tap.** The confirmation names the projects it will call, and
  those are the ones called, whatever the stream does to the list meanwhile.
- **Independent results, no retry, nothing optimistic.** Calls run in parallel; a failure names
  its project with Cezar's reason (FR-032) and keeps its markers. The index and open tasks are
  re-asked after the attempt; the in-flight state lasts until that lands.
- **Archive finished stays out** (issue's out-of-scope): it archives `failed` tasks too.

## Evidence

`evidence/` — offer, confirmation and partial failure at 390×844, light and dark (WebKit,
`test/e2e/task-list.spec.ts` with `E2E_EVIDENCE_DIR`).
