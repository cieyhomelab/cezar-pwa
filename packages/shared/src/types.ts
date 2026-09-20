/**
 * Shared run vocabulary, transcribed from `docs/CEZAR_API.md` §2.
 *
 * These are hand-written *locally scoped* types, not a mirror of Cezar's DTOs
 * (CLAUDE.md rule 3). They cover only the fields the attention rule reads.
 * Once `packages/cezar-contract/` is populated by `npm run sync:contract <sha>`,
 * prefer the vendored zod-inferred types over these.
 */

/** `docs/CEZAR_API.md` §2 → RunStatus. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled'

/**
 * Sub-state of `running`. Kept as an open string because the event/state
 * vocabulary is append-only (CLAUDE.md rule 5) — an unknown activity must not
 * change how a run is classified.
 */
export type RunActivity = string
