import { useQuery } from '@tanstack/react-query'
import { healthQueryOptions } from '../../api/health.ts'
import { APP_BUILT_AT, APP_COMMIT } from '../../config/app-version.ts'
import { TESTED_CEZAR_VERSION } from '../../config/cezar-compat.ts'
import { en } from '../../i18n/en.ts'

function builtAt(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  return at.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * FR-047: the product's version and the Cezar version it is talking to — the one the session
 * probe (`GET /api/v1/health`) reported, so it is the instance this app actually reaches. The
 * version this build was tested against sits beside them, as a fact and not a warning: the PRD
 * cut the "Cezar is newer" warning (Non-Goals).
 */
export function VersionsSection() {
  // Already in the cache: `AuthGate` asked it before this screen could render.
  const health = useQuery(healthQueryOptions())
  const t = en.settings.versions

  return (
    <section aria-labelledby="versions-heading" className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <h3 id="versions-heading" className="font-semibold">
        {t.section}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">{t.app}</dt>
        <dd className="break-words">{t.appValue(APP_COMMIT, builtAt(APP_BUILT_AT))}</dd>
        <dt className="text-text-muted">{t.cezar}</dt>
        <dd className="break-words">{health.data?.version ?? t.cezarUnknown}</dd>
        <dt className="text-text-muted">{t.tested}</dt>
        <dd>{TESTED_CEZAR_VERSION}</dd>
      </dl>
    </section>
  )
}
