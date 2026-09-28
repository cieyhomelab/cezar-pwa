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
  /**
   * What a poll matched: `#12 Fix the login` on GitHub, `PROJ-7 Fix the login` on Jira/Linear.
   * `url` only when it is http(s).
   */
  subject?: { text: string; url?: string }
  run?: { id: string; title?: string; status?: string }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const pad = (n: number) => String(n).padStart(2, '0')
const httpUrl = (value: unknown) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined)
/** A server word looked up in a copy table: own keys only, so `constructor` stays a raw word. */
const word = (table: object, key: string): string | undefined =>
  Object.hasOwn(table, key) ? (table as Record<string, string>)[key] : undefined
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
  return word(en.automations.events, event) ?? event
}

/**
 * A schedule's wall time is the server's (`timeZone`, UTC on the host), while every instant on the
 * screen is the phone's. Name the zone when the two clocks differ, so "04:00" beside "Next 06:00"
 * does not read as a contradiction. `localZone` undefined = the device's own.
 */
export function zoneSuffix(zone: unknown, localZone?: string, now: Date = new Date()): string {
  const name = text(zone)
  if (!name) return ''
  try {
    const clock = (timeZone?: string) => now.toLocaleString('en-GB', timeZone ? { timeZone } : {})
    return clock(name) === clock(localZone) ? '' : ` (${name})`
  } catch {
    // An IANA name this engine does not know: say nothing rather than guess.
    return ''
  }
}

const eventList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string') : [])

function providerText(kind: unknown): string {
  const t = en.automations.trigger
  return (typeof kind === 'string' ? word(t.providers, kind) : undefined) ?? t.unknownProvider
}

function triggerText(entry: Record<string, unknown>, suffix: string): string {
  const t = en.automations.trigger
  switch (entry.kind) {
    case 'schedule': {
      const schedule = scheduleText(entry.schedule)
      return schedule === t.unknown ? schedule : `${schedule}${suffix}`
    }
    case 'github': {
      const events = eventList(entry.events)
      return events.length > 0 ? t.github(events.map(eventText).join(', ')) : t.githubNoEvents
    }
    case 'tracker': {
      // Named after the association the automation polls, not the project's current tracker.
      const trigger = (typeof entry.trackerTrigger === 'object' && entry.trackerTrigger !== null ? entry.trackerTrigger : {}) as Record<
        string,
        unknown
      >
      const association = trigger.association as Record<string, unknown> | undefined
      const provider = providerText(association?.kind)
      const events = eventList(trigger.events)
      return events.length > 0 ? t.tracker(provider, events.map(eventText).join(', ')) : t.trackerNoEvents(provider)
    }
    default:
      return t.unknown
  }
}

export function automationRows(response: AutomationsResponse, localZone?: string): AutomationRow[] {
  const suffix = zoneSuffix(response.timeZone, localZone)
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
        trigger: triggerText(entry, suffix),
        ...(lastAt
          ? { lastRun: { at: lastAt, ...(lastRunId ? { runId: lastRunId } : {}), ...(lastStatus ? { status: lastStatus } : {}) } }
          : {}),
        // The server leaves it out while paused; a stale one must not read as "will fire".
        ...(enabled && next ? { nextRunAt: next } : {}),
      },
    ]
  })
}

/** The GitHub record a poll matched, else the Jira/Linear issue. */
function subjectOf(record: Record<string, unknown>): LogRow['subject'] {
  const number = typeof record.githubNumber === 'number' ? record.githubNumber : undefined
  const githubTitle = text(record.githubTitle)
  const github = number !== undefined ? [`#${number}`, githubTitle] : [githubTitle]
  const tracker = [text(record.trackerKey), text(record.trackerTitle)]
  const [parts, url] = github.some(Boolean) ? [github, record.githubUrl] : [tracker, record.trackerUrl]
  const subjectText = parts.filter(Boolean).join(' ')
  if (!subjectText) return undefined
  const link = httpUrl(url)
  return { text: subjectText, ...(link ? { url: link } : {}) }
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
    const subject = subjectOf(record)
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
        ...(subject ? { subject } : {}),
        ...(runId
          ? { run: { id: runId, ...(runTitle ? { title: runTitle } : {}), ...(runStatus ? { status: runStatus } : {}) } }
          : {}),
      },
    ]
  })
}

export function resultText(result: string): string {
  return word(en.automations.results, result) ?? result
}

/** Results worth the danger colour: something went wrong, not "nothing matched". */
export function isFailureResult(result: string): boolean {
  return result === 'error' || result === 'failed' || result === 'rate-limited'
}
