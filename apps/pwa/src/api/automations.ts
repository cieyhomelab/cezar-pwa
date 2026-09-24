import type {
  AutomationLogResponse,
  AutomationResponse,
  AutomationRunResponse,
  AutomationsResponse,
} from '@cezar-pwa/cezar-contract/contract'
import { ApiError, apiFetch } from './http.ts'
import { RUN_REFETCH_MS, WRITE_TIMEOUT_MS } from './run.ts'

/**
 * S-20: reacting to a project's automations (#70). Every route is a project route (rule 2), and
 * the whole family answers `409` while `health.capabilities.automations` is off:
 *
 *  - `GET /api/v1/p/:projectId/automations` — every definition with its state, last run and next
 *    occurrence, plus the forge's availability (`available: false` + `reason`, never a 5xx).
 *  - `POST …/automations/:id/pause` and `…/enable` → `{ automation }`. Enable arms a current-time
 *    baseline, so a GitHub poll never launches its lookback backlog.
 *  - `POST …/automations/:id/run` → `202 { runId }`. A schedule only: a GitHub automation answers
 *    `409` (it runs through `/check`, which stays in the cockpit — N05).
 *  - `GET …/automation-log` → `{ records, runs }`, newest first, capped at 100 rows.
 *
 * Creating, editing and deleting a definition stay in the cockpit (PRD Non-Goals, D07).
 * Only the containers are checked at runtime, as everywhere (rule 5); the rows are read field by
 * field in `domain/automations.ts`.
 */

export const automationsQueryKey = (projectId: string) => ['automations', projectId] as const
export const automationLogQueryKey = (projectId: string) => ['automation-log', projectId] as const

const projectPath = (projectId: string) => `/api/v1/p/${encodeURIComponent(projectId)}`
const automationPath = (projectId: string, automationId: string) =>
  `${projectPath(projectId)}/automations/${encodeURIComponent(automationId)}`

export async function fetchAutomations(projectId: string, signal?: AbortSignal): Promise<AutomationsResponse> {
  const body = await apiFetch<unknown>(`${projectPath(projectId)}/automations`, { signal })
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { automations?: unknown }).automations)) {
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
  }
  return body as AutomationsResponse
}

export async function fetchAutomationLog(projectId: string, signal?: AbortSignal): Promise<AutomationLogResponse> {
  const body = await apiFetch<unknown>(`${projectPath(projectId)}/automation-log`, { signal })
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { records?: unknown }).records)) {
    throw new ApiError('unexpected response shape', 200, 'unexpected-shape')
  }
  return body as AutomationLogResponse
}

/** Nothing streams automation changes to the phone: re-read every 30 s while the screen is open. */
export function automationsQueryOptions(projectId: string) {
  return {
    queryKey: automationsQueryKey(projectId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAutomations(projectId, signal),
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    refetchInterval: RUN_REFETCH_MS,
    retry: false,
  }
}

export function automationLogQueryOptions(projectId: string) {
  return {
    queryKey: automationLogQueryKey(projectId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAutomationLog(projectId, signal),
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    refetchInterval: RUN_REFETCH_MS,
    retry: false,
  }
}

export type AutomationActionId = 'pause' | 'enable' | 'run'

/** Not retried: a timed-out write may already have happened — for `run`, a task launched. */
export function pauseAutomation(projectId: string, automationId: string): Promise<AutomationResponse> {
  return apiFetch<AutomationResponse>(`${automationPath(projectId, automationId)}/pause`, {
    method: 'POST',
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}

export function enableAutomation(projectId: string, automationId: string): Promise<AutomationResponse> {
  return apiFetch<AutomationResponse>(`${automationPath(projectId, automationId)}/enable`, {
    method: 'POST',
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}

export function runAutomation(projectId: string, automationId: string): Promise<AutomationRunResponse> {
  return apiFetch<AutomationRunResponse>(`${automationPath(projectId, automationId)}/run`, {
    method: 'POST',
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}
