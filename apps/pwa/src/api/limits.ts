import type { LimitsResponse, LimitWindow, ProviderLimits } from '@cezar-pwa/shared'
import { ApiError, pushFetch } from './http.ts'

/**
 * `GET /m/push/limits` (#92, #93): each agent account's subscription windows as `cezar-push` last
 * read them. The sidecar polls on its own clock; the phone reads on open and on return to the
 * foreground only — never on a timer (PRD Non-Goals: no background work but the notification).
 */

export const LIMITS_QUERY_KEY = ['limits'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const shapeError = () => new ApiError('unexpected sidecar response shape', 200, 'unexpected-shape')

/**
 * A window the phone cannot read is dropped, not guessed at: the screen then says "not reported"
 * for it, which is the truth. An unknown `kind` is dropped the same way (append-only vocabulary).
 */
function readWindow(raw: unknown): LimitWindow | undefined {
  if (!isRecord(raw)) return undefined
  const { kind, model, usedPercent, resetsAt } = raw
  if (kind !== 'five_hour' && kind !== 'weekly' && kind !== 'weekly_model') return undefined
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return undefined
  return {
    kind,
    usedPercent,
    ...(typeof model === 'string' && model !== '' ? { model } : {}),
    ...(typeof resetsAt === 'string' ? { resetsAt } : {}),
  }
}

function readProvider(raw: unknown): ProviderLimits {
  if (!isRecord(raw)) throw shapeError()
  const { provider, account, status, observedAt, reason, windows } = raw
  if (typeof provider !== 'string' || typeof account !== 'string' || typeof observedAt !== 'string') {
    throw shapeError()
  }
  if (status !== 'ok' && status !== 'unavailable') throw shapeError()
  return {
    // A provider the phone does not know yet is still shown, under its own name.
    provider: provider as ProviderLimits['provider'],
    account,
    status,
    observedAt,
    ...(typeof reason === 'string' ? { reason } : {}),
    windows: Array.isArray(windows) ? windows.map(readWindow).filter((w) => w !== undefined) : [],
  }
}

export async function fetchLimits(options?: { signal?: AbortSignal }): Promise<LimitsResponse> {
  const body = await pushFetch<unknown>('/m/push/limits', { signal: options?.signal })
  if (!isRecord(body) || !Array.isArray(body.providers)) throw shapeError()
  const observedAt = typeof body.observedAt === 'string' ? body.observedAt : null
  return { observedAt, providers: body.providers.map(readProvider) }
}

export function limitsQueryOptions() {
  return {
    queryKey: LIMITS_QUERY_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchLimits({ signal }),
    // On open and on `visibilitychange → visible` (TanStack's focus manager); no `refetchInterval`.
    refetchOnWindowFocus: 'always' as const,
    refetchOnMount: 'always' as const,
    retry: false,
  }
}
