import type { LimitsResponse, LimitWindow, LimitWindowKind, ProviderLimits } from '@cezar-pwa/shared'
import { en } from '../i18n/en.ts'
import { shortAge } from './run-display.ts'

/**
 * The Limits screen's reading of `GET /m/push/limits` (#93): which cards, which bars in what
 * order, what each bar says. Pure, so the screen only lays it out.
 */

/** A reading older than this is dimmed and marked stale (#93). The sidecar polls every 5 min. */
export const LIMITS_STALE_AFTER_MS = 10 * 60_000

/** The plan's own windows, always shown — as "not reported" when the provider left one out. */
const FIXED_WINDOWS: readonly Exclude<LimitWindowKind, 'weekly_model'>[] = ['five_hour', 'weekly']

const PROVIDER_ORDER = ['claude', 'codex']

export type WindowRow = {
  key: string
  label: string
  /** Absent: the provider did not report this window. Never stands in as 0 or 100. */
  reading?: {
    /** 0–100, rounded, clamped: what the bar and the text both show. */
    percent: number
    /** "resets in 2h 14m", "reset due", or "no reset time given". */
    reset: string
  }
}

export type CardState = 'ok' | 'off' | 'unavailable'

export type LimitCardModel = {
  key: string
  provider: string
  account: string
  state: CardState
  /** The sidecar's own words for an `unavailable` row, verbatim. */
  reason?: string
  /** "4 min" — how old the reading is; empty when the stamp is unreadable. */
  age: string
  stale: boolean
  windows: WindowRow[]
}

/**
 * `2h 14m` / `45m` / `3d 4h` / `<1m`: a countdown, two units at most, never rounded up so it
 * cannot promise a reset sooner than it comes.
 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}

/** When a window resets, relative to `now`. */
export function resetText(resetsAt: string | undefined, now: number): string {
  const t = en.limits
  if (resetsAt === undefined) return t.noReset
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return t.noReset
  if (at <= now) return t.resetDue
  return t.resetsIn(formatDuration(at - now))
}

/** An unreadable stamp is stale: an age the phone cannot vouch for is not current. */
export function isStale(observedAt: string, now: number): boolean {
  const at = Date.parse(observedAt)
  return Number.isNaN(at) || now - at > LIMITS_STALE_AFTER_MS
}

export function clampPercent(usedPercent: number): number {
  return Math.min(100, Math.max(0, Math.round(usedPercent)))
}

function row(key: string, label: string, window: LimitWindow | undefined, now: number): WindowRow {
  return window === undefined
    ? { key, label }
    : { key, label, reading: { percent: clampPercent(window.usedPercent), reset: resetText(window.resetsAt, now) } }
}

/**
 * 5-hour, then weekly — both always, "not reported" when absent — then each per-model weekly
 * window the provider did report, by model name. Per-model rows are not invented: which models
 * a plan meters is the provider's call.
 */
export function windowRows(windows: readonly LimitWindow[], now: number): WindowRow[] {
  const t = en.limits.window
  const fixed = FIXED_WINDOWS.map((kind) =>
    row(
      kind,
      t[kind],
      windows.find((w) => w.kind === kind),
      now,
    ),
  )
  const perModel = windows
    .filter((w) => w.kind === 'weekly_model')
    .sort((a, b) => (a.model ?? '').localeCompare(b.model ?? ''))
    .map((w, index) => row(`weekly_model:${w.model ?? index}`, t.weeklyModel(w.model), w, now))
  return [...fixed, ...perModel]
}

/** `off in the sidecar config (…)`: switched off on purpose, not broken (`apps/push-sidecar`). */
const isSwitchedOff = (reason: string | undefined) => reason !== undefined && /^off\b/i.test(reason)

function cardState(row: ProviderLimits): CardState {
  if (row.status === 'ok') return 'ok'
  return isSwitchedOff(row.reason) ? 'off' : 'unavailable'
}

const providerRank = (provider: string) => {
  const index = PROVIDER_ORDER.indexOf(provider)
  return index === -1 ? PROVIDER_ORDER.length : index
}

/** One card per provider × account: Claude, then Codex; within one, `default` first. */
export function limitCards(response: LimitsResponse, now: number): LimitCardModel[] {
  return [...response.providers]
    .sort(
      (a, b) =>
        providerRank(a.provider) - providerRank(b.provider) ||
        a.provider.localeCompare(b.provider) ||
        Number(b.account === 'default') - Number(a.account === 'default') ||
        a.account.localeCompare(b.account),
    )
    .map((limits) => {
      const state = cardState(limits)
      return {
        key: `${limits.provider}/${limits.account}`,
        provider: limits.provider,
        account: limits.account,
        state,
        ...(state !== 'ok' && limits.reason ? { reason: limits.reason } : {}),
        age: shortAge(limits.observedAt, now),
        stale: isStale(limits.observedAt, now),
        windows: state === 'ok' ? windowRows(limits.windows, now) : [],
      }
    })
}
