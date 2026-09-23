import { en } from '../../i18n/en.ts'

/**
 * The probe got no answer at all.
 *
 * Kept apart from "Connect to Cezar" on purpose: a refusal and a dead network
 * look alike from the outside, and telling an operator on a bad train
 * connection that their access has lapsed would send them looking for a link
 * they do not need. The screen says only what is known, and offers the one
 * action that helps.
 */
export function UnreachableScreen({
  onRetry,
  isProbing,
}: {
  onRetry: () => void
  isProbing: boolean
}) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-xl font-semibold">{en.auth.unreachable.title}</h2>
      <p className="text-sm text-text-muted">{en.auth.unreachable.body}</p>
      <button
        type="button"
        className="touch-target rounded border border-border px-4 text-sm"
        onClick={onRetry}
        disabled={isProbing}
      >
        {isProbing ? en.auth.rechecking : en.auth.recheck}
      </button>
    </section>
  )
}
