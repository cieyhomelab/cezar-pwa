import type { AutomationLogResponse, AutomationsResponse } from '@cezar-pwa/cezar-contract/contract'
import { en } from '../i18n/en.ts'

/**
 * S-20 (#70): the automations list and its log, read field by field. The vocabulary is
 * append-only (rule 5): an event, result or kind added upstream reads as its raw word or as
 * "unknown trigger", and never drops the row.
 */

export interface AutomationRow {
  id: string
  name: string
  enabled: boolean
  /** `schedule` fires by hand through `/run`; a GitHub poll does not (it runs through `/check`). */
  canRunNow: boolean
  trigger: string
  /** The newest launch: its time and, when the list joined it, the run and its status. */
  lastRun?: { at: string; runId?: string; status?: string }
  /** Absent while paused or never armed. */
  nextRunAt?: string
}

export interface LogRow {
  key: string
  at: string
  automationName: string
  result: string
  reason?: string
  /** `#12 Fix the login` — the GitHub record a poll matched. */
  github?: string
  run?: { id: string; title?: string; status?: string }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const pad = (n: number) => String(n).padStart(2, '0')
const int = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isInteger(value) ? value : fallback)

/** The schedule shapes, with the contract's defaults (`normalizeSchedule`: 04:00, Monday, 6 h). */
export function scheduleText(schedule: unknown): string {
  const t = en.automations.trigger
  if (typeof schedule !== 'object' || schedule === null) return t.unknown
  const s = schedule as Record<string, unknown>
  const at = `${pad(int(s.hour, 4))}:${pad(int(s.minute, 0))}`
  switch (s.type) {
    case 'daily':
      return t.daily(at)
    case 'weekdays':
      return t.weekdays(at)
    case 'weekly':
      return t.weekly(t.days[int(s.day, 1) - 1] ?? t.days[0], at)
    case 'hours':
      return t.hours(int(s.every, 6))
    default:
      return t.unknown
  }
}

export function eventText(event: string): string {
  return (en.automations.events as Record<string, string>)[event] ?? event
}

function triggerText(entry: Record<string, unknown>): string {
  const t = en.automations.trigger
  switch (entry.kind) {
    case 'schedule':
      return scheduleText(entry.schedule)
    case 'github': {
      const events = Array.isArray(entry.events) ? entry.events.filter((e): e is string => typeof e === 'string') : []
      return events.length > 0 ? t.github(events.map(eventText).join(', ')) : t.githubNoEvents
    }
    default:
      return t.unknown
  }
}

export function automationRows(response: AutomationsResponse): AutomationRow[] {
  return response.automations.flatMap((raw): AutomationRow[] => {
    const entry = raw as unknown as Record<string, unknown>
    const id = text(entry.id)
    if (!id) return []
    const enabled = entry.enabled === true
    const lastRun = entry.lastRun as Record<string, unknown> | undefined
    const state = entry.state as Record<string, unknown> | undefined
    const lastAt = text(lastRun?.ts) ?? text(state?.lastRunAt)
    const lastRunId = text(lastRun?.runId)
    const lastStatus = text(lastRun?.status)
    const next = text(entry.nextRunAt)
    return [
      {
        id,
        name: text(entry.name) ?? id,
        enabled,
        canRunNow: entry.kind === 'schedule',
        trigger: triggerText(entry),
        ...(lastAt
          ? { lastRun: { at: lastAt, ...(lastRunId ? { runId: lastRunId } : {}), ...(lastStatus ? { status: lastStatus } : {}) } }
          : {}),
        // The server leaves it out while paused; a stale one must not read as "will fire".
        ...(enabled && next ? { nextRunAt: next } : {}),
      },
    ]
  })
}

export function logRows(response: AutomationLogResponse, names: ReadonlyMap<string, string>): LogRow[] {
  const runs = (typeof response.runs === 'object' && response.runs !== null ? response.runs : {}) as Record<
    string,
    Record<string, unknown> | undefined
  >
  return response.records.flatMap((raw, index): LogRow[] => {
    const record = raw as unknown as Record<string, unknown>
    const at = text(record.ts)
    if (!at) return []
    const automationId = text(record.automationId) ?? ''
    const runId = text(record.runId)
    const run = runId ? runs[runId] : undefined
    const number = typeof record.githubNumber === 'number' ? record.githubNumber : undefined
    const title = text(record.githubTitle)
    const github = number !== undefined ? (title ? `#${number} ${title}` : `#${number}`) : title
    const reason = text(record.reason)
    const runTitle = text(run?.title)
    const runStatus = text(run?.status)
    return [
      {
        key: typeof record.seq === 'number' ? `seq-${record.seq}` : `row-${index}`,
        at,
        automationName: names.get(automationId) ?? (automationId || en.automations.log.unknownAutomation),
        result: text(record.result) ?? '',
        ...(reason ? { reason } : {}),
        ...(github ? { github } : {}),
        ...(runId
          ? { run: { id: runId, ...(runTitle ? { title: runTitle } : {}), ...(runStatus ? { status: runStatus } : {}) } }
          : {}),
      },
    ]
  })
}

export function resultText(result: string): string {
  return (en.automations.results as Record<string, string>)[result] ?? result
}

/** Results worth the danger colour: something went wrong, not "nothing matched". */
export function isFailureResult(result: string): boolean {
  return result === 'error' || result === 'failed' || result === 'rate-limited'
}
