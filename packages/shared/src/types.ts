/**
 * Shared run vocabulary.
 *
 * Spelled out rather than imported from `@cezar-pwa/cezar-contract`, because this package is
 * built to `dist/` for the sidecar and the vendored contract is TypeScript source only. The
 * PWA asserts at compile time that these stay equal to the contract's types
 * (`apps/pwa/src/domain/contract-parity.test.ts`), so the duplication cannot drift silently.
 */

/** `runStatusSchema` in `packages/contract/src/runs.ts`. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled'

/**
 * Sub-state of `running` — `runActivitySchema` upstream, today only `'monitoring'`. Kept as an
 * open string because the vocabulary is append-only (CLAUDE.md rule 5): an activity this copy
 * has never seen must classify as plain `running`, not fail to type or to render.
 */
export type RunActivity = string
