import type { ReactNode } from 'react'
import { pl } from '../../i18n/pl.ts'
import { ConnectScreen } from './ConnectScreen.tsx'
import { UnreachableScreen } from './UnreachableScreen.tsx'
import { consumeUnlockOutcome } from './unlock.ts'
import { useSession } from './useSession.ts'

/**
 * Everything carrying task data renders inside this (PRD § Access Control:
 * "the static shell carries no data … everything that carries task data
 * requires [a session]").
 *
 * It is wiring only — the four states it can be in are decided in
 * `useSession`, and each has its own screen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession()
  // Read outside any effect: the key must leave the history entry before the
  // first paint, not after it. The call memoises, so this is one strip per load
  // even under StrictMode's double render.
  const unlockFailed = consumeUnlockOutcome()

  if (session.status === 'connected') return <>{children}</>

  if (session.status === 'checking') {
    return (
      <p role="status" className="flex flex-1 items-center justify-center px-6 text-text-muted">
        {pl.auth.checking}
      </p>
    )
  }

  if (session.status === 'unreachable') {
    return <UnreachableScreen onRetry={session.recheck} isProbing={session.isProbing} />
  }

  return (
    <ConnectScreen
      unlockFailed={unlockFailed}
      onRecheck={session.recheck}
      isProbing={session.isProbing}
    />
  )
}
