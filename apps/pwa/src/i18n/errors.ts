import { ApiError } from '../api/http.ts'
import { pl } from './pl.ts'

/**
 * The detail line a screen prints under its own "nie udało się wczytać…".
 *
 * Two kinds of `ApiError` reach a screen and they must not be shown the same way. One carries
 * Cezar's own `{ error }`, which is shown verbatim (FR-032) — the server speaks the operator's
 * language and paraphrasing it would hide what it said. The other is this layer's own judgement
 * about an unusable answer, and it carries a code instead of words, so the sentence comes from
 * `pl.apiError` (CLAUDE.md: UI text only from `i18n/pl.ts`).
 *
 * `undefined` when there is nothing worth adding: a failure of another kind, or a status with no
 * reason behind it. The caller then shows its heading alone rather than an empty line.
 */
export function apiErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  if (error.code === undefined) return error.message
  return pl.apiError[error.code] || undefined
}
