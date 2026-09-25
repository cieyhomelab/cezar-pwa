import { agentProfilesResponseSchema } from '@cezar-pwa/cezar-contract/contract'
import type { LimitsProvider, LimitsResponse, ProviderLimits } from '@cezar-pwa/shared'
import { unavailable, type LimitsAccount, type LimitsAdapter, type LimitsReading } from './types.ts'

/** Cezar's account list (`docs/CEZAR_API.md` § 2), read over loopback like the watcher's reads. */
export const AGENT_PROFILES_PATH = '/api/v1/workspace/agent-profiles'

export const LIMITS_INTERVAL_MS = 5 * 60_000
const PROFILES_TIMEOUT_MS = 10_000
/** A row this many intervals old is no longer served as current. */
const STALE_AFTER_INTERVALS = 3

export const PROVIDERS: readonly LimitsProvider[] = ['claude', 'codex']

/** An adapter to run, or the reason it is switched off (`LIMITS_CLAUDE`, `LIMITS_CODEX`). */
export type ProviderSetting = { adapter: LimitsAdapter } | { disabled: string }

export type CollectorOptions = {
  /** Cezar on loopback — past the gate, no cookie needed. */
  cezarUrl: string
  providers: Record<LimitsProvider, ProviderSetting>
  intervalMs?: number
  fetch?: typeof fetch
  log?: (message: string) => void
  now?: () => Date
}

/**
 * Polls every provider × account for its subscription windows and keeps the last reading of each
 * in memory for `GET /m/push/limits` (#92). All the work happens here, on the sidecar's clock: the
 * phone only ever reads the result.
 *
 * Logs a row only when its status changes, and never a number, a path or a credential.
 */
export class LimitsCollector {
  private readings: ProviderLimits[] = []
  private observedAt: string | null = null
  private readonly options: CollectorOptions
  private readonly intervalMs: number
  private readonly doFetch: typeof fetch
  private readonly now: () => Date
  private readonly logged = new Map<string, string>()
  private stopped = false
  private wake: (() => void) | undefined

  constructor(options: CollectorOptions) {
    this.options = options
    this.intervalMs = options.intervalMs ?? LIMITS_INTERVAL_MS
    this.doFetch = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  /** What the route serves. A row the poll loop has not refreshed in a while is not current. */
  snapshot(): LimitsResponse {
    const staleBefore = this.now().getTime() - STALE_AFTER_INTERVALS * this.intervalMs
    return {
      observedAt: this.observedAt,
      providers: this.readings.map((row) =>
        row.status === 'ok' && Date.parse(row.observedAt) < staleBefore
          ? { ...row, status: 'unavailable', reason: 'no fresh reading: the sidecar has not polled lately', windows: [] }
          : row,
      ),
    }
  }

  /** One full pass. Replaces every row, so a failed adapter never leaves its old numbers behind. */
  async pollOnce(): Promise<void> {
    const accounts = await this.accounts()
    const rows = await Promise.all(accounts.map((account) => this.read(account)))
    for (const row of rows) this.logChange(row)
    this.readings = rows
    this.observedAt = this.now().toISOString()
  }

  /** Runs until `stop()`: a pass, then the interval. */
  async run(): Promise<void> {
    while (!this.stopped) {
      await this.pollOnce()
      if (this.stopped) break
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.intervalMs)
        this.wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
  }

  stop(): void {
    this.stopped = true
    this.wake?.()
  }

  private async read(account: LimitsAccount): Promise<ProviderLimits> {
    const setting = this.options.providers[account.provider]
    let reading: LimitsReading
    if ('disabled' in setting) {
      reading = unavailable(setting.disabled)
    } else {
      try {
        reading = await setting.adapter(account)
      } catch {
        // The error itself is not quoted: nothing guarantees it holds no secret.
        reading = unavailable('the limits read failed unexpectedly')
      }
    }
    return {
      provider: account.provider,
      account: account.id,
      observedAt: this.now().toISOString(),
      ...(reading.status === 'ok'
        ? { status: 'ok', windows: reading.windows }
        : { status: 'unavailable', reason: reading.reason, windows: [] }),
    }
  }

  /**
   * Cezar's agent profiles, per provider. A provider with none — `profiles: []` on this host, and
   * the fallback when Cezar cannot be read — gets one `default` account: the CLI's own login.
   */
  private async accounts(): Promise<LimitsAccount[]> {
    let profiles: { id: string; provider: string; path: string }[] = []
    try {
      const response = await this.doFetch(new URL(AGENT_PROFILES_PATH, this.options.cezarUrl), {
        signal: AbortSignal.timeout(PROFILES_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      profiles = agentProfilesResponseSchema.parse(await response.json()).profiles
      this.logged.delete('profiles')
    } catch (error) {
      this.logOnce('profiles', `limits: agent profiles unreadable (${describe(error)}), reading default accounts`)
    }
    return PROVIDERS.flatMap((provider): LimitsAccount[] => {
      const own = profiles.filter((profile) => profile.provider === provider)
      if (own.length === 0) return [{ provider, id: 'default', configDir: undefined }]
      return own.map((profile) => ({ provider, id: profile.id, configDir: profile.path }))
    })
  }

  private logChange(row: ProviderLimits): void {
    const state = row.status === 'ok' ? 'ok' : `unavailable (${row.reason ?? ''})`
    this.logOnce(`${row.provider}/${row.account}`, `limits: ${row.provider}/${row.account} ${state}`)
  }

  private logOnce(key: string, message: string): void {
    if (this.logged.get(key) === message) return
    this.logged.set(key, message)
    this.options.log?.(message)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === 'ZodError') return 'unexpected shape'
  if (error instanceof Error && /^HTTP \d+$/.test(error.message)) return error.message
  return 'unreachable'
}
