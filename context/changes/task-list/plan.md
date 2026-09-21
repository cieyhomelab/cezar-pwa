# Task list — Implementation Plan

## Overview

Close roadmap slice **S-03** (`task-list`): the operator opens the icon and sees every task
across all registered projects, grouped with anything needing attention first, each row
readable without opening it, refreshable by pulling and on returning to the app, and
filterable by project.

Derived from `context/foundation/roadmap.md` § S-03, PRD US-02, FR-007–009, FR-011, FR-013,
and Cezar's cockpit source at `v0.11.0`. See `change.md` for why F-02 lands here too.

## Current State Analysis

| S-03 capability | State before this change |
| --- | --- |
| Vendored contract (F-02) | **absent** — `packages/cezar-contract/src/` empty |
| Attention rule | present, but written from docs and awaiting reconciliation with upstream |
| Unread rule, title rule, PR/issue rule | **absent** |
| Runs index fetch | **absent** |
| List screen | **absent** — a placeholder sentence behind the gate |

### Key discoveries

- **The cockpit has two answers to "needs you".** `wantsAttention()` (notifications:
  waiting, review, failed) and the sidebar's `Needs you` bucket (waiting, review only). The
  PRD binds the list's top section to the *notification* answer ("all three must agree"), so
  that is what the list uses. Consequence worth knowing: a failed task stays in "Wymaga
  uwagi" until it is archived or continued — the cockpit's sidebar files it under Recent.
- **`deriveAttention()`'s last rung is a catch-all labelled `cancelled`.** Copied 1:1, but the
  badge shows an unknown status as its raw name — calling a new state "cancelled" would be
  exactly the confidently-wrong status the PRD calls the worst failure.
- **The queue is workspace-wide.** `maxParallel` is one semaphore across projects and a freed
  slot goes to the longest-waiting run (`workspace/semaphore.ts`), so queue numbers are
  computed across projects, before the filter.
- **`runs-index` carries no `pinned` and no `groupId`**, so the phone list has no Pinned
  section and no variant collapsing. Both are the cockpit's; neither is in the PRD.
- **An installed iOS PWA has no pull-to-refresh**, so the gesture is rebuilt (passive
  listeners, drag must start at the top).
- **Runtime zod validation would break the guardrail.** The contract's enums are closed; a
  new upstream status would fail the whole parse. Schemas validate fixtures in tests only.

## What We're NOT Doing

- **No live updates** (FR-010, FR-012) — S-04. A 30 s refetch while visible is the interim.
- **No task screen** — S-05. Rows do not navigate yet.
- **No pinning, archiving or other actions** — S-08.
- **No persisted snapshot** — a PRD non-goal.

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 0 | Vendor the contract (F-02); contract tests over live + hand-written fixtures | `packages/cezar-contract/**`, `apps/pwa/test/{contract,fixtures}/` |
| 1 | Port the attention and read-state rules 1:1 | `packages/shared/src/{attention,read-state}.ts` |
| 2 | List logic: sections, order, queue numbers; row display rules | `apps/pwa/src/domain/{task-list,run-display}.ts` |
| 3 | Fetch the index; refetch on foreground and interval | `apps/pwa/src/api/runs-index.ts` |
| 4 | Screen, row, badge; filter, pull-to-refresh, clock hooks | `apps/pwa/src/features/runs-list/*`, `src/i18n/pl.ts`, `src/index.css`, `src/App.tsx` |
| 5 | E2E in WebKit; docs | `test/e2e/task-list.spec.ts`, `docs/CEZAR_API.md` |

## Progress

- [x] **Unit + component tests** — 223 passing (`npm test`): upstream's attention and
      read-state tables, list sectioning/ordering/queue numbers, the row display rules, and
      the screen's filter, refresh, pull, foreground, stale and refusal paths.
- [x] **Contract tests** — live `health` and `runs-index` captures and the hand-written
      fixture all validate against the vendored schemas.
- [x] **Typecheck and lint** — `npm run typecheck`, `npm run lint` clean.
- [x] **E2E (WebKit, iPhone 14)** — 23 passing, 5 of them new: three-second headline, no
      sideways scroll at 390 px, filter surviving a reload, button and foreground refresh, a
      lapsed session landing on "Połącz z Cezarem".
- [x] **Both themes at 390×844** — `evidence/`.
- [x] **Live data** — rendered against the instance's real `runs-index` (`evidence/live-dark.png`).
- [ ] **Manual: on the phone** — pull to refresh and return-from-background on the installed
      app (a headless browser cannot produce either gesture faithfully).
