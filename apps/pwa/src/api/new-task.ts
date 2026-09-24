import type {
  AgentProfilesResponse,
  ConfigResponse,
  CreateRunInput,
  Runner,
  RunnerModelCatalogResponse,
  WorkflowsResponse,
} from '@cezar-pwa/cezar-contract/contract'
import { discoversModels } from '../domain/new-task.ts'
import { ApiError, apiFetch } from './http.ts'
import { WRITE_TIMEOUT_MS } from './run.ts'

/**
 * S-13: what the new-task form reads (FR-033) and the one write it makes (FR-034). Project
 * routes go through `/api/v1/p/:projectId/…` (CLAUDE.md rule 2); the model catalog and the agent
 * accounts are the host's, so they are workspace routes.
 *
 * As elsewhere, only the containers the form iterates are checked. A missing one is an error.
 */

function projectBase(projectId: string): string {
  return `/api/v1/p/${encodeURIComponent(projectId)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const unexpected = () => new ApiError('unexpected response shape', 200, 'unexpected-shape')

/** `GET /api/v1/p/:projectId/workflows`: the chain catalog. Files that failed to load ride in
 *  `issues` and are not offered. */
export async function fetchWorkflows(projectId: string, signal?: AbortSignal): Promise<WorkflowsResponse> {
  const body = await apiFetch<unknown>(`${projectBase(projectId)}/workflows`, { signal })
  if (!isRecord(body) || !Array.isArray(body.workflows)) throw unexpected()
  return {
    workflows: body.workflows.filter(
      (workflow): workflow is WorkflowsResponse['workflows'][number] =>
        isRecord(workflow) && typeof workflow.name === 'string',
    ),
    issues: Array.isArray(body.issues) ? (body.issues as WorkflowsResponse['issues']) : [],
  }
}

/** `GET /api/v1/p/:projectId/config`: the project's default runner and per-runner model presets. */
export async function fetchProjectConfig(projectId: string, signal?: AbortSignal): Promise<ConfigResponse> {
  const body = await apiFetch<unknown>(`${projectBase(projectId)}/config`, { signal })
  if (!isRecord(body)) throw unexpected()
  return body as ConfigResponse
}

/**
 * `GET /api/v1/models?runner=…`: the models the host's own installation of that runner offers.
 * A runner with no discovery path has no catalog, which is an empty list rather than a 400.
 * The route itself never fails: an unavailable CLI answers `source: 'unavailable'`.
 */
export async function fetchModels(runner: Runner, signal?: AbortSignal): Promise<RunnerModelCatalogResponse> {
  if (!discoversModels(runner)) {
    return { runner, models: [], source: 'unavailable', stale: false }
  }
  const body = await apiFetch<unknown>(`/api/v1/models?runner=${encodeURIComponent(runner)}`, { signal })
  if (!isRecord(body) || !Array.isArray(body.models)) throw unexpected()
  return {
    ...(body as RunnerModelCatalogResponse),
    models: body.models.filter(
      (model): model is RunnerModelCatalogResponse['models'][number] =>
        isRecord(model) && typeof model.id === 'string' && typeof model.label === 'string',
    ),
  }
}

/** `GET /api/v1/workspace/agent-profiles`: the agent accounts. Empty on this host (hosted mode). */
export async function fetchAgentProfiles(signal?: AbortSignal): Promise<AgentProfilesResponse> {
  const body = await apiFetch<unknown>('/api/v1/workspace/agent-profiles', { signal })
  if (!isRecord(body) || !Array.isArray(body.profiles)) throw unexpected()
  return body as AgentProfilesResponse
}

/**
 * The form's choices change seldom and cost the server a catalog read each; a minute is fresh
 * enough, and nothing retries silently (the same reasoning as the other reads).
 */
const choices = { staleTime: 60_000, retry: false }

export function workflowsQueryOptions(projectId: string) {
  return {
    queryKey: ['workflows', projectId] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchWorkflows(projectId, signal),
    ...choices,
  }
}

export function projectConfigQueryOptions(projectId: string) {
  return {
    queryKey: ['config', projectId] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchProjectConfig(projectId, signal),
    ...choices,
  }
}

export function modelsQueryOptions(runner: Runner) {
  return {
    queryKey: ['models', runner] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchModels(runner, signal),
    ...choices,
  }
}

export function agentProfilesQueryOptions() {
  return {
    queryKey: ['agent-profiles'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAgentProfiles(signal),
    ...choices,
  }
}

/**
 * `POST /api/v1/p/:projectId/runs` (201). Not retried: a timed-out create may already have
 * started a task, and a second one would be a duplicate agent at work.
 */
export function createRun(projectId: string, input: CreateRunInput): Promise<unknown> {
  return apiFetch<unknown>(`${projectBase(projectId)}/runs`, {
    method: 'POST',
    body: input,
    timeoutMs: WRITE_TIMEOUT_MS,
  })
}
