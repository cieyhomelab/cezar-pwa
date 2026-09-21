import { Link } from 'react-router'
import { pl } from '../../i18n/pl.ts'
import { NotificationsSection } from './NotificationsSection.tsx'

/**
 * Settings. S-10 brings the first section, notifications (FR-036); theme, versions and sign-out
 * are S-12's.
 */
export function SettingsScreen() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-20 flex h-11 items-center border-b border-border bg-surface px-2">
        <Link to="/" className="touch-target inline-flex items-center px-2 text-accent">
          <span aria-hidden="true">‹&nbsp;</span>
          {pl.settings.back}
        </Link>
      </div>
      <h2 className="px-4 pt-3 text-lg font-semibold">{pl.settings.title}</h2>
      <NotificationsSection />
    </div>
  )
}
