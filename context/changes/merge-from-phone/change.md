---
change_id: merge-from-phone
title: Merge a PR from the phone, with CI checks and merge state
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #69, slice **S-19** (second-round roadmap). Allowed by the Non-Goal the operator narrowed
on 2026-09-24 (D07/N06): merging behind a confirmation, with CI checks and merge state, is
allowed. Browsing files, reviews and comments stays on GitHub. The PRD already carried the
narrowed non-goal (#73). FR-032 for refusals, brief R03 for the confirmation.

There was no spec file; the issue body is the spec. Routes were read from the installed Cezar
`0.11.1` server (`dist/server/server.js` and `forge/github.js`, `normalizeMergeState` and
`mergePullRequest`), the vendored contract (`githubPrMergeStateResponseSchema`,
`githubMergeResponseSchema`), and the cockpit's own merge box (`GithubMergeBox` in
`packages/web/src/routes/github/github.tsx` at the pinned commit).

## Decisions

- **The server judges eligibility; the phone only re-words it.** `domain/merge.ts` offers a merge
  exactly when the server would accept one: `canMerge`, or `canOverride` after the operator ticks
  "Merge without waiting for requirements" (`overrideRules: true`). The same as the cockpit.
- **The override is needed on this host.** The repository is private, so GitHub does not show its
  branch-protection rules (`required: null`, `reviewDecision: unknown`). An open PR therefore comes
  back `eligibility: unknown`, `canMerge: false`, `canOverride: true`. Without the override the
  phone could never merge here, and neither could the cockpit.
- **The merge names the head the operator saw** (`expectedHeadSha`). A push after the screen read
  the state is refused (`409 stale-head`) instead of being merged unseen.
- **Never optimistic.** After every attempt (merged, refused or timed out), the state is re-read
  with `refresh=1`, past the server's 15-second cache. The panel shows that answer. The run and the
  list are re-asked too. The merge is never retried, because a timed-out merge may already have
  happened.
- **Which PR:** the one the header links to (`prLink`). The route is scoped to the project's
  repository, so an answer whose `url` is not that PR (another repository, same number) is shown as
  "not in the project's repository", with no merge offered.
- **Checks come from the merge state.** It carries every check with its name, state and link, so
  `GET …/github/checks?prs=` (one glyph per PR) is not used.
- Method choice sits in the confirmation (`methods`, starting on `defaultMethod`). The
  confirmation names the PR number, its title, the base branch and the short head SHA.
- Re-read every 30 s and on return to the foreground while the PR is open. Once it is merged or
  closed, it is no longer re-read.
- Draft → ready is out of scope. A draft shows "mark it ready on GitHub" and no merge button (the
  server gives no `canOverride` for a draft).

## Evidence

Stubbed API, WebKit iPhone 14 at 390×844, `deviceScaleFactor: 1`:
`evidence/merge-state-{light,dark}.png` (blocked by a failing check),
`evidence/confirm-merge-{light,dark}.png` (confirmation after the override),
`evidence/merged-{light,dark}.png` (the re-read state after the merge).
