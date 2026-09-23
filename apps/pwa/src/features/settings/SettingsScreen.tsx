import { Link } from 'react-router'
import { en } from '../../i18n/en.ts'
import { NotificationsSection } from './NotificationsSection.tsx'
import { SignOutSection } from './SignOutSection.tsx'
import { ThemeSection } from './ThemeSection.tsx'
import { useSignOut } from './useSignOut.ts'
import { VersionsSection } from './VersionsSection.tsx'

/**
 * Settings. S-10 brought notifications (FR-036); S-12 adds the theme (FR-046), both versions
 * (FR-047) and sign-out (FR-006). Sign-out goes last: it is the one that cannot be taken back
 * from here.
 */
export function SettingsScreen() {
  const signOut = useSignOut()

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-20 flex h-11 items-center border-b border-border bg-surface px-2">
        <Link to="/" className="touch-target inline-flex items-center px-2 text-accent">
          <span aria-hidden="true">‹&nbsp;</span>
          {en.settings.back}
        </Link>
      </div>
      <h2 className="px-4 pt-3 text-lg font-semibold">{en.settings.title}</h2>
      {/* Keyed on the sign-out attempt: after one that stayed here, both read the cleared state. */}
      <ThemeSection key={`theme-${signOut.attempt}`} />
      <NotificationsSection key={`push-${signOut.attempt}`} />
      <VersionsSection />
      <SignOutSection signOut={signOut} />
    </div>
  )
}
