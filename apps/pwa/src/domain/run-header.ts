import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { prNumber } from './run-display.ts'

/**
 * What the task header says (FR-014): workflow, step progress, runner and model, tokens, the
 * PR link. Title, status and cost reuse the list's rules in `run-display.ts`. The workflow label
 * and token format copy the cockpit's (`lib/tasks-table.ts` → `workflowLabel`, `lib/format.ts`
 * → `compactTokens`, tag `v0.11.0`).
 */

/** An inline chain shows its first agent step's name, not the bare `(planned)` placeholder. */
export function workflowLabel(run: Pick<ApiRun, 'workflow' | 'steps'>): string {
  if (run.workflow === '(planned)' || run.workflow === '(inbox)') {
    const agent = (run.steps ?? []).find((step) => step.kind === 'agent')
    if (agent?.name) return agent.name
  }
  return run.workflow
}

export type StepProgress = { position: number; total: number; name: string }

/**
 * Where the run is in its chain. The current step is `currentStepId`. Without one (a finished
 * run clears it) it is the last step that started, and before anything started it is the first.
 * `null` for a chain of one step: "1/1" says nothing.
 */
export function stepProgress(run: Pick<ApiRun, 'steps' | 'currentStepId'>): StepProgress | null {
  const steps = Array.isArray(run.steps) ? run.steps : []
  if (steps.length < 2) return null
  let index = steps.findIndex((step) => step.id === run.currentStepId)
  if (index < 0) {
    for (let i = steps.length - 1; i >= 0 && index < 0; i -= 1) {
      if (steps[i]?.status !== 'pending') index = i
    }
  }
  if (index < 0) index = 0
  return { position: index + 1, total: steps.length, name: steps[index]?.name ?? '' }
}

/** `claude · claude-opus-5`, or whichever half is known. Empty when neither is. */
export function runnerModel(run: Pick<ApiRun, 'runner' | 'model'>): string {
  return [run.runner, run.model].filter((part) => typeof part === 'string' && part !== '').join(' · ')
}

/** `812` / `96.2k` / `1.4M`, truncated rather than rounded (upstream's `compactTokens`). */
export function compactTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0'
  if (tokens >= 1_000_000) return `${(Math.floor(tokens / 100_000) / 10).toFixed(1)}M`
  if (tokens >= 1_000) return `${(Math.floor(tokens / 100) / 10).toFixed(1)}k`
  return String(Math.floor(tokens))
}

export type TokenSummary =
  | { kind: 'directional'; input: string; output: string }
  | { kind: 'total'; total: string }
  | null

/**
 * Directional counts when the record has them, the total otherwise. `null` for a run that has
 * used nothing yet, because `0 tokens` next to a queued task reads like a measurement.
 */
export function tokenSummary(run: Pick<ApiRun, 'tokensUsed' | 'inputTokens' | 'outputTokens'>): TokenSummary {
  if (typeof run.inputTokens === 'number' && typeof run.outputTokens === 'number') {
    if (run.inputTokens + run.outputTokens > 0) {
      return { kind: 'directional', input: compactTokens(run.inputTokens), output: compactTokens(run.outputTokens) }
    }
  }
  return run.tokensUsed > 0 ? { kind: 'total', total: compactTokens(run.tokensUsed) } : null
}

export type PrLink = { url: string; number: string | null }

/**
 * The PR the header links to: the one the task created, otherwise the one it is about. An
 * issue-subject run that declared no PR adopts no stray one (#526, as in `taskReference`). Only
 * `http(s)` URLs become links, because a URL is data the agent influenced.
 */
export function prLink(
  run: Pick<ApiRun, 'pullRequestUrl' | 'referencedPullRequestUrl' | 'markerRefs'>,
): PrLink | null {
  const suppressAboutPr = run.markerRefs?.issue !== undefined && run.markerRefs?.pr === undefined
  const candidates = [run.pullRequestUrl, suppressAboutPr ? undefined : run.referencedPullRequestUrl]
  for (const url of candidates) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return { url, number: prNumber(url) }
  }
  return null
}

/** The task screen's path under the router's `/m/` basename. Ids are url-encoded. */
export function runPath(projectId: string, runId: string): string {
  return `/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`
}

/** S-09: the task's diff, one level under its screen. */
export function diffPath(projectId: string, runId: string): string {
  return `${runPath(projectId, runId)}/diff`
}
