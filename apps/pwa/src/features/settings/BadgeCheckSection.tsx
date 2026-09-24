import { useState } from 'react'
import { en } from '../../i18n/en.ts'
import { applyBadge, badgeSupported, type BadgeOutcome } from '../../pwa/app-badge.ts'
import { useStandalone } from '../../pwa/useStandalone.ts'

const BUTTON =
  'touch-target inline-flex items-center justify-center rounded border border-border bg-surface-raised px-4 text-sm text-text disabled:opacity-60'

type Result = { action: 'set' | 'clear'; outcome: BadgeOutcome }

/**
 * #68, TEMPORARY: the on-device answer to PRD Open Question 4 — does an icon badge work in the
 * installed app? Cases 1 and 3 of the issue are the two buttons; case 2 (the worker, during a push)
 * is the test notification, which sets the badge to 1 (`sw.ts`). Remove with `app-badge.ts` once
 * the answer is recorded.
 */
export function BadgeCheckSection() {
  const standalone = useStandalone()
  const [supported] = useState(() => badgeSupported(navigator))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>()
  const t = en.settings.badge

  const run = async (action: Result['action']) => {
    setBusy(true)
    const outcome = await applyBadge(navigator, action === 'set' ? 3 : null)
    setResult({ action, outcome })
    setBusy(false)
  }

  return (
    <section aria-labelledby="badge-heading" className="flex flex-col gap-3 border-b border-border px-4 py-3">
      <h3 id="badge-heading" className="font-semibold">
        {t.section}
      </h3>
      {standalone ? (
        <>
          <p className="text-sm text-text-muted">{t.intro}</p>
          <p className="text-sm">{supported ? t.supported : t.unsupported}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void run('set')}>
              {t.set}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void run('clear')}>
              {t.clear}
            </button>
          </div>
          {result ? (
            result.outcome.ok ? (
              <p role="status" className="text-sm text-text-muted">
                {result.action === 'set' ? t.didSet : t.didClear}
              </p>
            ) : (
              <p role="alert" className="text-sm break-words text-danger">
                {result.outcome.reason === 'unsupported' ? t.unsupported : t.failed(result.outcome.message)}
              </p>
            )
          ) : null}
        </>
      ) : (
        <p className="text-sm text-text-muted">{t.tabOnly}</p>
      )}
    </section>
  )
}
