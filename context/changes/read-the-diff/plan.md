# Read the diff — Implementation Plan

## Overview

Close roadmap slice **S-09** (`read-the-diff`). From the task screen the operator opens what the
agent changed and reads it file by file: each file's path, how it changed and by how many lines,
and, once opened, its patch. Read-only, lines wrapped, no syntax highlighting (FR-031).

Derived from `context/foundation/roadmap.md` § S-09, PRD FR-031 and Cezar's source at `v0.11.0`.
See `change.md`.

## Current State Analysis

| S-09 capability | State before this change |
| --- | --- |
| Diff read | **absent** from `src/api/`. |
| Patch parsing | **absent**. The transcript's tool lines carry `diffs[]`, but S-05 renders them collapsed to one line. |
| Diff screen and route | **absent**. The header showed the branch, not what changed on it. |
| Contract | `changesPayloadSchema` / `changedFileSchema` were already vendored (`contract/repo.ts`). |

### Key discoveries

- **Two endpoints, and only one is safe to render.** `GET …/runs/:id/diff` answers one
  `text/plain` blob, and for a run without a worktree it answers the sentence
  `(no worktree — …)` as a **200**, which a phone would render as a diff. `GET …/runs/:id/changes`
  answers `{ files, stat, repointedHead? }` with every file's own patch, measured against the
  same base as the cockpit's Changes tab (`resolveTaskDiffBase`), and turns "nothing to diff"
  into a `409` with the reason. The phone reads `/changes`.
- **The server already splits per file.** `ChangedFile.patch` is one `diff --git` section, capped
  at 200 000 characters with `… (patch truncated)`. "File by file" is the payload's own shape. What
  is left is reading hunks into numbered lines, and the cockpit's `parsePatch` does exactly that.
- **The cockpit's phone layout is the PRD's.** Below `md` the Changes tab forces unified + wrap and
  hides the file tree ("a 360px phone has no honest room for a second column"). The phone copies
  that and drops what only a wide screen uses: split rows, word-level marks, expandable context
  (which needs a second request per file).
- **A review task's worktree is repointed.** Measured live: a finished review run answers
  `{ files: [], stat: 0, repointedHead: { headBranch: 'HEAD', taskBranch: 'cez/…' } }`. The screen
  says so rather than just "no changes".
- **`diffStat` on the record is late.** It is refreshed on every turn end and absent before the
  first. The header row is always there, with the numbers when the record has them.

## What We're NOT Doing

- **No syntax highlighting.** A PRD non-goal, and the largest thing that could land here.
- **No split view, no word-level marks, no expandable context.** Wide-screen features. Context
  would also need a second request per file.
- **No image previews.** The phone loads no images (S-05's rule). An image is one line of text.
- **No commits tab, no file browser, no git actions** (commit, push, open in terminal). Only the
  diff is in the PRD. The draft PR is S-08's.
- **No virtualization.** `virtua` is a Non-Goal (Open Roadmap Question 5). Instead, files start
  closed (except a lone file) and a long file renders 1000 lines at a time.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | Patch parsing and the per-file rules as pure functions, ported from the cockpit's `parsePatch` | `apps/pwa/src/domain/diff.ts` |
| 2 | The read: `/changes`, 15 s timeout, no retry, 30 s refresh only while the task is active. Only `files` is checked; a malformed file costs itself, and `stat` is summed from the rows | `apps/pwa/src/api/changes.ts` |
| 3 | The screen: back to the task, summary, repointed note, one collapsible section per file, the patch with gutter numbers and `+`/`−` markers, paging, and notes for binary, image, content-less and truncated files | `features/diff/DiffScreen.tsx`, `FileDiff.tsx`, `DiffCounts.tsx`, `routes.tsx`, `i18n/pl.ts`, `index.css` |
| 4 | The way in: a "Zmiany" row in the task header | `RunHeader.tsx`, `domain/run-header.ts` (`diffPath`) |
| 5 | Table tests, component tests, live fixtures in the contract test, WebKit E2E, evidence, docs | `diff.test.ts`, `DiffScreen.test.tsx`, `test/contract/fixtures.test.ts`, `test/e2e/diff.spec.ts`, `docs/CEZAR_API.md` |

### Design notes

- **A screen, not a panel on the task screen.** The task screen is already a live transcript with
  a docked composer. A diff has its own scroll length, and its own route means the back gesture
  returns to the task.
- **Wrapped, never scrolled sideways.** `pre-wrap` plus `overflow-wrap: anywhere`, so an
  unbroken 250-character token still wraps. The E2E checks that the page does not scroll
  sideways.
- **Not colour alone.** Each line carries its `+`/`−` marker, and a screen reader hears
  "added:" / "removed:". The counts read as words.
- **The file header stays on screen** (`sticky`) while its patch scrolls under it.

## Progress

- [x] **Unit + component tests**: 537 passing (`npm test`), 45 of them new. The table tests pin
      hunk parsing and line numbers (new, deleted, bare blank context, "no newline"), the
      server's truncation, the body kind per file (binary, SVG image, pure rename, cut before
      any hunk), and paging. The component tests drive the screen: every file listed closed,
      with status, directory and rename source. Opening shows the hunk header and the marked
      lines, and closing hides them. Binary, image and content-less notes. A lone file arrives
      open. A 1005-line file pages. The truncation note links to the cockpit. The repointed note.
      An unknown status reads as changed and a patchless file is dropped. Empty diffs differ for
      a settled and a working task. A 409 shows the reason verbatim. An unknown answer is an
      error, never "no changes". A lapsed session goes to the gate. The header row opens the
      screen, with and without `diffStat`. The live fixture renders git's own patch.
- [x] **Contract**: two live `/changes` captures from `0.11.0` validate against
      `changesPayloadSchema`.
- [x] **Typecheck and lint**: `npm run typecheck`, `npm run lint` clean.
- [x] **E2E (WebKit, iPhone 14)**: 50 passing, 2 of them new. From the header row to a file's
      patch and back. The file header is ≥ 44 px, and a line wider than the phone wraps with
      nothing scrolling sideways. A 409 shows the server's reason.
- [x] **Both themes at 390×844**: `evidence/header-light.png`, `header-dark.png`,
      `files-light.png`, `files-dark.png`, `open-light.png`, `open-dark.png`,
      `refused-light.png`, and `live-dark.png` (the live instance).
- [ ] **Manual: on the phone**: open a real review's diff from the installed app.

## Found while building

- **`/changes` writes to the task worktree's index.** For a worktree it owns, Cezar runs
  `git add -N .` (intent-to-add) before diffing, so untracked files show. Reading this task's own
  diff live left a scratch file in the index as intent-to-add after the file was deleted. Nothing
  for the phone to change, since that is how the cockpit's Changes tab works too. But it means
  opening a diff is not a pure read of the worktree. The main checkout is protected
  (`intentToAdd: false` → scratch index).
