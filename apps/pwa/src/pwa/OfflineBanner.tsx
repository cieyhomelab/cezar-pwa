import { en } from '../i18n/en.ts'

/**
 * FR-002: with no network the product says so plainly, instead of a blank
 * screen, a load that never resolves, or data it cannot vouch for.
 *
 * `role="status"` is what carries the change to a screen reader — status is
 * never conveyed by colour alone (NF: "status is legible without
 * distinguishing colours").
 */
export function OfflineBanner({ online }: { online: boolean }) {
  if (online) return null

  return (
    <div
      role="status"
      className="border-b border-border bg-surface-raised px-4 py-2 text-sm"
    >
      {en.offline.banner}
    </div>
  )
}
