/**
 * `GET /m/push/limits` — each agent account's subscription windows, as `cezar-push` last read them
 * (#92). Defined here so the PWA imports the shape instead of mirroring it (CLAUDE.md rule 3).
 *
 * The sidecar polls; the phone only reads what the last poll found.
 */

/** Providers that have subscription windows at all. Gemini has none (#92, out of scope). */
export type LimitsProvider = 'claude' | 'codex'

/**
 * `five_hour` and `weekly` are the plan's rolling windows; `weekly_model` is Claude's per-model
 * weekly bar (Opus, Sonnet). A window the provider did not report is ABSENT from `windows` —
 * never a 0 or a 100 standing in for "not reported".
 */
export type LimitWindowKind = 'five_hour' | 'weekly' | 'weekly_model'

export type LimitWindow = {
  kind: LimitWindowKind
  /** Only on `weekly_model`, e.g. `opus`. */
  model?: string
  /** 0–100, as the provider reports it. */
  usedPercent: number
  /** ISO 8601. Absent when the provider gave no reset time. */
  resetsAt?: string
}

/**
 * One account of one provider. `unavailable` carries a `reason` in the operator's terms and no
 * windows: an adapter that failed never serves its previous reading as current.
 */
export type ProviderLimits = {
  provider: LimitsProvider
  /** Cezar's agent-profile id; `default` for the account the CLI finds on its own. */
  account: string
  status: 'ok' | 'unavailable'
  /** When this row was read — per row, so one stale reading can be dimmed on its own. */
  observedAt: string
  reason?: string
  windows: LimitWindow[]
}

export type LimitsResponse = {
  /** When the last poll finished; `null` until the first one has. */
  observedAt: string | null
  providers: ProviderLimits[]
}
