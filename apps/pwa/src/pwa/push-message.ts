import type { PushPayload } from '@cezar-pwa/shared'
import { runPath } from '../domain/run-header.ts'
import { en } from '../i18n/en.ts'

/**
 * What the service worker shows for a push and where a tap goes (FR-038, FR-041, FR-043). Pure, so
 * the worker's handlers are thin and this is testable without a worker.
 */

/** The router's basename. A notification's URL is absolute; the app's paths are under it. */
const BASE = '/m'

/** The test notification's tag: one at a time, and the worker recognises it on a tap. */
export const TEST_TAG = 'cezar-test'

/** The message the worker posts to an open window instead of reloading it. */
export const NAVIGATE_MESSAGE = 'cezar:navigate'

type Record_ = { [key: string]: unknown }

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/**
 * The sidecar's payload, read defensively: a field of the wrong type is dropped, an unknown field
 * ignored (rule 5), and a body that is not JSON at all becomes nothing rather than a throw.
 */
export function readPushPayload(raw: unknown): PushPayload {
  if (typeof raw !== 'object' || raw === null) return { kind: 'attention' }
  const data = raw as Record_
  const optional = (key: keyof PushPayload) => (text(data[key]) ? { [key]: data[key] } : {})
  return {
    kind: data.kind === 'test' ? 'test' : 'attention',
    ...optional('projectId'),
    ...optional('projectName'),
    ...optional('runId'),
    ...optional('title'),
    ...optional('reason'),
  }
}

/** FR-041: the task's transcript, or the list when the payload does not name a task. */
export function targetUrl(payload: PushPayload): string {
  return payload.projectId && payload.runId ? `${BASE}${runPath(payload.projectId, payload.runId)}` : `${BASE}/`
}

export type NotificationSpec = {
  title: string
  // `renotify` is in the Notifications spec but not in TypeScript's DOM lib.
  options: NotificationOptions & { data: { url: string }; renotify?: boolean }
}

/**
 * Which task, which project, and why (FR-038) — nothing else (FR-043). The tag is per task, so a
 * newer notification about the same task replaces the one before it instead of stacking (FR-039).
 * `renotify` makes that replacement ring: the sidecar only sends a new transition, and a task that
 * went from "needs you" to "failed" is news, not a silent edit of a notification already seen.
 */
export function notificationFor(payload: PushPayload): NotificationSpec {
  const icon = `${BASE}/icons/icon-192.png`
  if (payload.kind === 'test') {
    return {
      title: en.push.testTitle,
      options: { body: en.push.testBody, tag: TEST_TAG, icon, data: { url: `${BASE}/` } },
    }
  }
  const reason = payload.reason
    ? (en.push.reason[payload.reason] ?? en.runs.status[payload.reason] ?? payload.reason)
    : en.push.fallbackReason
  const project = payload.projectName ?? payload.projectId
  return {
    title: payload.title ?? en.push.fallbackTitle,
    options: {
      body: project ? `${project} · ${reason}` : reason,
      tag: payload.runId ? `cezar-run-${payload.projectId ?? ''}/${payload.runId}` : 'cezar',
      renotify: true,
      icon,
      data: { url: targetUrl(payload) },
    },
  }
}

/**
 * The app path to route to for a URL the worker sent, or `undefined` for anything that is not a
 * same-origin path inside the app. A message is only ever from our own worker, but the page
 * checks anyway: it navigates on it.
 */
export function appPathFor(url: unknown, origin: string): string | undefined {
  if (typeof url !== 'string') return undefined
  let parsed: URL
  try {
    parsed = new URL(url, origin)
  } catch {
    return undefined
  }
  if (parsed.origin !== origin) return undefined
  if (parsed.pathname !== `${BASE}/` && !parsed.pathname.startsWith(`${BASE}/`)) return undefined
  return parsed.pathname.slice(BASE.length) + parsed.search
}

/** A window of this app to reuse (FR-041): the first one whose URL is inside `/m/`. */
export function pickAppWindow<T extends { url: string }>(windows: readonly T[]): T | undefined {
  return windows.find((client) => {
    try {
      const { pathname } = new URL(client.url)
      return pathname === `${BASE}/` || pathname.startsWith(`${BASE}/`)
    } catch {
      return false
    }
  })
}
