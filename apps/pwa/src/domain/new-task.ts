import type {
  AgentProfile,
  BackendCheck,
  CreateRunInput,
  ModelDiscoveryRunner,
  Runner,
  WorkflowDef,
} from '@cezar-pwa/cezar-contract/contract'

/**
 * S-13: the new-task form's choices (FR-033) and the body it sends. Pure, so the screen only
 * wires queries to these.
 */

/** The runners a task can be dispatched to, in the contract's order (`runnerSchema`). */
const RUNNERS: readonly Runner[] = ['claude', 'codex', 'opencode', 'pi']

/**
 * The runners with a host-discovered model catalog: the only ones `GET /api/v1/models` answers
 * for. The contract's `runnerDiscoversModels` says the same, but importing it would bundle zod;
 * the `satisfies` keeps this list inside the contract's enum.
 */
const MODEL_DISCOVERY: readonly Runner[] = ['claude', 'codex', 'opencode'] as const satisfies readonly ModelDiscoveryRunner[]

export function discoversModels(runner: Runner): boolean {
  return MODEL_DISCOVERY.includes(runner)
}

/** The server's default when a body names none (`docs/CEZAR_API.md` § 4). */
export const DEFAULT_WORKFLOW = 'quick-task'

/**
 * The runners installed on the host, from the health probe's `checks`: only those can take a
 * task. `gh` and `git` sit in the same list and are not runners.
 */
export function installedRunners(checks: readonly BackendCheck[] | undefined): Runner[] {
  const available = new Set((checks ?? []).filter((check) => check.available).map((check) => check.name))
  return RUNNERS.filter((runner) => available.has(runner))
}

/** The runner preselected: the project's own default, else the host's, else the first installed. */
export function initialRunner(
  installed: readonly Runner[],
  projectDefault: Runner | undefined,
  hostDefault: Runner | undefined,
): Runner | undefined {
  if (projectDefault && installed.includes(projectDefault)) return projectDefault
  if (hostDefault && installed.includes(hostDefault)) return hostDefault
  return installed[0]
}

/** The workflow preselected: the built-in `quick-task`, as in the cockpit, else the first listed. */
export function initialWorkflow(workflows: readonly Pick<WorkflowDef, 'name'>[]): string | undefined {
  return workflows.find((workflow) => workflow.name === DEFAULT_WORKFLOW)?.name ?? workflows[0]?.name
}

/** The model preselected for a runner: the project's preset for it, when it is on offer. Absent
 *  means "Auto" — the runner decides, and the body names no model. */
export function initialModel(
  preset: string | undefined,
  offered: readonly { id: string }[],
): string | undefined {
  return preset && offered.some((model) => model.id === preset) ? preset : undefined
}

/** The accounts a runner can use. None → no picker, the project's own selection applies. */
export function profilesFor(profiles: readonly AgentProfile[] | undefined, runner: Runner | undefined): AgentProfile[] {
  return runner ? (profiles ?? []).filter((profile) => profile.provider === runner) : []
}

export interface NewTaskForm {
  task: string
  workflow: string
  runner?: Runner
  model?: string
  agentProfile?: string
  autonomous: boolean
}

/**
 * The `POST …/runs` body. Unset choices stay out rather than going as empty strings: the server
 * reads an absent key as "use the default", and an empty model or profile id as a mistake.
 * `variants` and `dispatch` are never sent — they stay in the cockpit (issue #62).
 */
export function createRunBody(form: NewTaskForm): CreateRunInput {
  return {
    task: form.task.trim(),
    workflow: form.workflow,
    ...(form.runner ? { runner: form.runner } : {}),
    ...(form.model ? { model: form.model } : {}),
    ...(form.agentProfile ? { agentProfile: form.agentProfile } : {}),
    autonomous: form.autonomous,
  }
}

/**
 * The run to open once Cezar created it. `createRunResponseSchema` is a union: one record, or
 * `{ runs }` for variants. The form never asks for variants, but a server that answered with a
 * group anyway still made the first one.
 */
export function createdRunId(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) return undefined
  const body = response as { id?: unknown; runs?: unknown }
  if (typeof body.id === 'string') return body.id
  if (Array.isArray(body.runs)) {
    const first = body.runs[0] as { id?: unknown } | undefined
    if (typeof first?.id === 'string') return first.id
  }
  return undefined
}
