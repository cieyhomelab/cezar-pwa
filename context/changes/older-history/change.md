---
change_id: older-history
title: Load older transcript history by scrolling up
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #64, roadmap S-15, PRD FR-049. The task screen showed only the newest history page and
linked to the cockpit for anything older. There was no spec file; the issue body is the spec.

## Decisions

- **One cache entry.** Older pages are prepended to the page `['history', projectId, runId]`
  already holds (`prependOlder()` in `apps/pwa/src/domain/live-transcript.ts`), not kept in a
  second query. The stream keeps appending to the same list, the fold still reads one list of raw
  lines, and nothing else learns about pages. The fetch is a `useMutation` (`useOlderHistory`).
- **Merge raw lines by `seq`, never folded pages.** A turn crosses page boundaries, and the
  server repeats a turn's opening line in front of the page after it. `mergeBySeq` handles both.
  Tested on Cezar 0.11.1's own pages of a long synthetic run: walking every cursor gives exactly
  the file's lines and the same fold as reading the file whole.
- **Refetches keep what was read back** (`carryOver`), but only when the fresh page overlaps the
  held one. Otherwise the fresh page alone is shown, as before: lines between the two are on
  neither page, and keeping the earlier lines would hide that hole. Overlap = the fresh page's
  *second* line is at or below the held mark; its first can be the repeated opener.
- **Keeping the place by hand** (`useKeepPlace`), like `useScrollAnchor` on the list: Safari's
  scroll anchoring cannot be relied on. The pin is an entry (`data-entry-key`), not a turn: the
  turn the newest page opened mid-way gains entries above and may change id. The E2E runs with
  native anchoring on and off; with the hook disabled the entry jumps ~5,000 px either way.
- **Not "new messages".** `useFollowBottom` takes the transcript's first `seq`: when it changes,
  content arrived above, so nothing is followed or announced.
- **Trigger:** an `IntersectionObserver` on the top line (300 px ahead), plus the same line as a
  button. No automatic retry; a failure shows Retry and the cockpit link, and the transcript
  stays. `hasOlder` without a cursor keeps the old cockpit link.
- Out of scope, per the issue: virtualising long transcripts.

## Evidence

`evidence/` — the failed-page alert and the start of the transcript at 390×844, light and dark
(WebKit, `test/e2e/older-history.spec.ts` with `E2E_EVIDENCE_DIR`).
