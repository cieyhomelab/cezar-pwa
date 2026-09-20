/**
 * Local types for API shapes this client reads, kept here until F-02
 * (`vendor-cezar-contract`) vendors the real zod schemas into
 * `packages/cezar-contract/`.
 *
 * Source: `docs/CEZAR_API.md` § 2 — `GET /api/v1/health` → `healthResponseSchema`
 * in `packages/contract/src/` of `open-mercato/cezar`. CLAUDE.md rule 3 allows a
 * local type only with a note saying where it comes from; delete this file's
 * entries as the vendored schemas land.
 *
 * Every field is optional but `version`: the vocabulary is append-only and the
 * product must never break on a payload that grew (CLAUDE.md rule 5).
 */

export type CezarProject = {
  id: string
  name: string
}

export type HealthResponse = {
  version: string
  projects?: CezarProject[]
  bootProject?: string | null
}
