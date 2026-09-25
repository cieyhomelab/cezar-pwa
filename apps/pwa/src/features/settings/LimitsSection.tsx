import { Link } from 'react-router'
import { en } from '../../i18n/en.ts'

/** #93: the way to the Limits screen from Settings, beside the list header's link. */
export function LimitsSection() {
  const t = en.limits

  return (
    <section aria-labelledby="limits-heading" className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <h3 id="limits-heading" className="font-semibold">
        {t.section}
      </h3>
      <p className="text-sm text-text-muted">{t.intro}</p>
      <Link
        to="/limits"
        className="touch-target inline-flex items-center self-start rounded border border-border bg-surface-raised px-4 text-sm"
      >
        {t.open}
      </Link>
    </section>
  )
}
