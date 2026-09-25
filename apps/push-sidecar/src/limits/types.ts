import type { LimitsProvider, LimitWindow } from '@cezar-pwa/shared'

/** One account to read: a Cezar agent profile, or the CLI's own default when there is none. */
export type LimitsAccount = {
  provider: LimitsProvider
  /** Cezar's profile id; `default` for the discovered account. */
  id: string
  /**
   * The account's config dir (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). `undefined` = let the CLI find
   * its own, exactly as a run on the discovered account would.
   */
  configDir: string | undefined
}

/**
 * What one adapter read for one account. `reason` is shown to the operator as is, so it must never
 * carry a token, a cookie or a credential — adapters build it from their own words only.
 */
export type LimitsReading =
  | { status: 'ok'; windows: LimitWindow[] }
  | { status: 'unavailable'; reason: string }

/** Reads one account. Must not throw; the collector still guards it in case it does. */
export type LimitsAdapter = (account: LimitsAccount) => Promise<LimitsReading>

export const unavailable = (reason: string): LimitsReading => ({ status: 'unavailable', reason })
