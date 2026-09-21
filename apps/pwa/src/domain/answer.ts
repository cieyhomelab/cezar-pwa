import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import type { UiAskQuestion } from '@cezar-pwa/cezar-contract/protocol'
import type { Transcript, TranscriptAsk } from './transcript.ts'

/**
 * S-07: how text the operator writes reaches the agent (FR-022, FR-023). A port of the cockpit's
 * delivery rules at `v0.11.0`: `ask-answer.ts`, `ask-card.tsx` and the composer's routing in
 * `task-thread.tsx`, under `packages/web/src/routes/task-thread/`. The phone must answer a
 * question the same way the laptop does, or the agent reads two different replies.
 */

/** Only these fields decide the route, so the tests do not need whole records. */
export type DeliveryRun = Pick<ApiRun, 'status' | 'steps'>

/** The engine still owns the run (upstream `isRunActive`). `review` is not active: it is parked. */
export function isRunActive(status: string): boolean {
  return status === 'running' || status === 'queued' || status === 'waiting'
}

/** The latest agent session across steps, the one a resume reopens (upstream `lastSessionId`). */
export function lastSessionId(run: DeliveryRun): string | undefined {
  const steps = Array.isArray(run.steps) ? run.steps : []
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const sessionId = steps[i]?.sessionId
    if (typeof sessionId === 'string' && sessionId !== '') return sessionId
  }
  return undefined
}

/**
 * Which door the text goes through (upstream `askDeliveryMode`):
 *  - `live`: the engine still owns a session, or the run has not started. `POST …/messages`.
 *  - `resume`: the session ended with a session recorded. `POST …/continue` with the text as
 *    the opening prompt. This is how a question outlives an idle timeout or a restart.
 *  - `unavailable`: closed, and nothing to reopen.
 */
export type DeliveryMode = 'live' | 'resume' | 'unavailable'

export function deliveryMode(run: DeliveryRun): DeliveryMode {
  if (isRunActive(run.status)) return 'live'
  return lastSessionId(run) !== undefined ? 'resume' : 'unavailable'
}

/**
 * Whether the free-text composer is offered. FR-023 names a running or waiting task, and a
 * queued one takes messages too (they are folded into its prompt). A closed task gets the
 * composer only while an unanswered question can still reopen it: plain "continue this task"
 * is S-08's action, not a message.
 */
export function composerOpen(run: DeliveryRun, openAsk: TranscriptAsk | undefined): boolean {
  const mode = deliveryMode(run)
  return mode === 'live' || (mode === 'resume' && openAsk !== undefined)
}

/**
 * The question still waiting for the operator: the newest ask, if it is unanswered. The reducer
 * resolves only the newest ask on the next message, so an older unanswered one is superseded and
 * must not look answerable.
 */
export function openAsk(transcript: Transcript): TranscriptAsk | undefined {
  for (let t = transcript.turns.length - 1; t >= 0; t -= 1) {
    const entries = transcript.turns[t]?.entries ?? []
    for (let e = entries.length - 1; e >= 0; e -= 1) {
      const entry = entries[e]
      if (entry?.kind === 'ask') return entry.resolved ? undefined : entry
    }
  }
  return undefined
}

/** One question's answer, as the agent reads it back (upstream `formatAnswer`). */
export function formatAnswer(question: UiAskQuestion, labels: readonly string[]): string {
  return `${question.header}: ${labels.join(', ')}`
}

/** Every question's answer in one message, one per line: the reducer resolves the whole card on
 *  one user message, so answers are never sent piecemeal. */
export function combineAnswers(
  questions: readonly UiAskQuestion[],
  selections: Readonly<Record<number, readonly string[]>>,
): string {
  return questions.map((question, index) => formatAnswer(question, selections[index] ?? [])).join('\n')
}

/** A single single-select question answers on one tap. Any other shape needs a combined send. */
export function isOneTap(questions: readonly UiAskQuestion[]): boolean {
  return questions.length === 1 && questions[0]?.multiSelect !== true
}

/** Toggle `label` in a question's selection. Single-select replaces, multi-select toggles. */
export function toggleSelection(selected: readonly string[], label: string, multiSelect: boolean): string[] {
  if (!multiSelect) return [label]
  return selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label]
}

/**
 * The idle timer closes the session a moment before the run record lets go of it. A resume sent
 * in that window is refused with exactly this 409, and only that refusal is retried, on
 * upstream's schedule (`IDLE_TEARDOWN_RETRY_DELAYS_MS`, about 6 s in all).
 */
export const IDLE_TEARDOWN_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1_000, 1_000, 1_000, 1_000] as const

export function isIdleTeardownRefusal(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { status?: unknown }).status === 409 &&
    error.message === 'run is still active'
  )
}

export async function resumeAfterIdleTeardown<T>(
  resume: () => Promise<T>,
  wait: (delayMs: number) => Promise<void> = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<T> {
  for (let retries = 0; ; retries += 1) {
    try {
      return await resume()
    } catch (error) {
      const delayMs = IDLE_TEARDOWN_RETRY_DELAYS_MS[retries]
      if (!isIdleTeardownRefusal(error) || delayMs === undefined) throw error
      await wait(delayMs)
    }
  }
}
