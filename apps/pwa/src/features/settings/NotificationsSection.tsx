import { en } from '../../i18n/en.ts'
import { usePushSubscription } from './usePushSubscription.ts'

const BASE = 'touch-target inline-flex items-center justify-center rounded px-4 text-sm disabled:opacity-60'
const STYLE = {
  primary: `${BASE} bg-accent font-semibold text-white`,
  outline: `${BASE} border border-border bg-surface-raised text-text`,
} as const

/**
 * FR-036, FR-037: notifications are turned on here and only here, from a tap. In a browser tab the
 * section says how to install instead — iOS has no Web Push outside the installed app, so a button
 * there would promise something it cannot do.
 */
export function NotificationsSection() {
  const push = usePushSubscription()
  const t = en.push

  return (
    <section aria-labelledby="push-heading" className="flex flex-col gap-3 border-b border-border px-4 py-3">
      <h3 id="push-heading" className="font-semibold">
        {t.section}
      </h3>
      <p className="text-sm text-text-muted">{t.intro}</p>

      {push.availability === 'install' ? (
        <div role="note" className="flex flex-col gap-1 rounded border border-border bg-surface-raised px-3 py-2">
          <p className="text-sm font-medium">{t.installTitle}</p>
          <p className="text-sm text-text-muted">{t.installBody}</p>
        </div>
      ) : null}
      {push.availability === 'unsupported' ? <p className="text-sm">{t.unsupported}</p> : null}
      {push.availability === 'denied' ? <p className="text-sm">{t.denied}</p> : null}

      {push.availability === 'available' ? (
        push.subscription === undefined ? (
          <p className="text-sm text-text-muted">{t.checking}</p>
        ) : push.subscription === null ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t.off}</p>
            <div>
              <button type="button" className={STYLE.primary} disabled={push.busy !== undefined} onClick={push.enable}>
                {push.busy === 'enable' ? t.enabling : t.enable}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t.on}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={STYLE.outline} disabled={push.busy !== undefined} onClick={push.test}>
                {push.busy === 'test' ? t.testing : t.test}
              </button>
              <button type="button" className={STYLE.outline} disabled={push.busy !== undefined} onClick={push.disable}>
                {push.busy === 'disable' ? t.disabling : t.disable}
              </button>
            </div>
          </div>
        )
      ) : null}

      {push.error ? (
        <p role="alert" className="text-sm break-words text-danger">
          {push.error}
        </p>
      ) : null}
      {push.notice ? (
        <p role="status" className="text-sm text-text-muted">
          {push.notice}
        </p>
      ) : null}
    </section>
  )
}
