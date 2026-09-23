import { type FormEvent, useState } from 'react'
import { type AccessLinkProblem, buildUnlockUrl } from '../../domain/access-link.ts'
import { en } from '../../i18n/en.ts'
import { useStandalone } from '../../pwa/useStandalone.ts'
import { navigateToUnlock } from './unlock.ts'

const problemMessage: Record<AccessLinkProblem, string> = {
  empty: en.auth.errors.empty,
  'not-a-url': en.auth.errors.notAUrl,
  'foreign-origin': en.auth.errors.foreignOrigin,
  'missing-key': en.auth.errors.missingKey,
}

export type ConnectScreenProps = {
  /** A previous attempt came back with the key untouched — see `unlock.ts`. */
  unlockFailed?: boolean
  /** Re-run the session probe. */
  onRecheck: () => void
  isProbing: boolean
  /** Seams for tests, which must not perform a real navigation. */
  origin?: string
  navigate?: (url: string) => void
  /** Defaults to detection; decides which fallback advice is true here. */
  standalone?: boolean
}

/**
 * FR-004 and FR-005: the app says it is not authorized, and offers the one
 * action that can fix it.
 *
 * This is deliberately not a login form — there is no account and no password;
 * Cezar ships no authentication at all (`docs/CEZAR_API.md` § 1a). It is a
 * doorway: the operator pastes the access link they already hold, the app
 * rewrites it to its own path so the gateway's redirect lands back here, and
 * navigates. The pasted value lives in this component's state until submit and
 * is dropped immediately after (R-AUTH-5).
 */
export function ConnectScreen({
  unlockFailed = false,
  onRecheck,
  isProbing,
  origin = window.location.origin,
  navigate = navigateToUnlock,
  standalone: standaloneOverride,
}: ConnectScreenProps) {
  const detectedStandalone = useStandalone()
  const standalone = standaloneOverride ?? detectedStandalone
  const [link, setLink] = useState('')
  const [problem, setProblem] = useState<AccessLinkProblem | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const result = buildUnlockUrl(link, { origin })
    if (!result.ok) {
      setProblem(result.problem)
      return
    }
    setLink('')
    setProblem(null)
    navigate(result.url)
  }

  return (
    <section className="flex flex-1 flex-col gap-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-semibold">{en.auth.title}</h2>
        <p className="mt-2 text-sm text-text-muted">{en.auth.intro}</p>
      </div>

      {unlockFailed && (
        <div role="alert" className="rounded border border-border bg-surface-raised p-3 text-sm">
          <p>{en.auth.unlockFailed}</p>
          {/* In the installed app there is no other way in, so the one
              remaining cause the operator can act on is the server. In a tab,
              opening the link directly works too. */}
          <p className="mt-2 text-text-muted">
            {standalone ? en.auth.unlockFailedServer : en.auth.manualTab}
          </p>
        </div>
      )}

      <form className="flex flex-col gap-2" onSubmit={onSubmit} noValidate>
        <label className="text-sm font-medium" htmlFor="access-link">
          {en.auth.linkLabel}
        </label>
        <input
          id="access-link"
          type="url"
          inputMode="url"
          // Nothing about this value should be remembered, corrected, or
          // capitalised by the browser: it is a secret, and it is case- and
          // character-exact.
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="touch-target rounded border border-border bg-surface-raised px-3 py-2 text-base"
          placeholder={en.auth.linkPlaceholder}
          value={link}
          onChange={(event) => {
            setLink(event.target.value)
            setProblem(null)
          }}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : 'access-link-error'}
        />
        {problem !== null && (
          <p id="access-link-error" role="alert" className="text-sm text-text">
            {problemMessage[problem]}
          </p>
        )}
        <p className="text-sm text-text-muted">{en.auth.privacy}</p>
        <button
          type="submit"
          className="touch-target rounded bg-accent px-4 text-base font-medium text-white"
        >
          {en.auth.submit}
        </button>
      </form>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        {!standalone && !unlockFailed && (
          <p className="text-sm text-text-muted">{en.auth.manualTab}</p>
        )}
        <button
          type="button"
          className="touch-target rounded border border-border px-4 text-sm"
          onClick={onRecheck}
          disabled={isProbing}
        >
          {isProbing ? en.auth.rechecking : en.auth.recheck}
        </button>
      </div>
    </section>
  )
}
