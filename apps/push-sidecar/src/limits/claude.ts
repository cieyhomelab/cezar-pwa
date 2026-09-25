import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LimitWindow } from '@cezar-pwa/shared'
import { z } from 'zod'
import { unavailable, type LimitsAdapter, type LimitsReading } from './types.ts'

/**
 * Claude Code (Pro/Max) windows from `GET https://api.anthropic.com/api/oauth/usage` — the
 * endpoint behind `/usage`. UNDOCUMENTED: it may change without notice, which is why the adapter
 * is off unless `LIMITS_CLAUDE` turns it on and why every drift degrades to `unavailable`.
 *
 * The OAuth token is read from the account's `.credentials.json` on every request and lives only
 * in that request's header: never logged, cached, written to disk, or put in a reason. The
 * sidecar never refreshes it either (that would rewrite the CLI's credentials) — an expired token
 * is reported, and the next `claude` run on that account refreshes it.
 */
export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const CLAUDE_TIMEOUT_MS = 10_000

const credentialsSchema = z.object({
  claudeAiOauth: z.object({ accessToken: z.string().min(1), expiresAt: z.number().optional() }),
})

const windowSchema = z.object({ utilization: z.number(), resets_at: z.string().nullish() }).nullish()

const usageSchema = z.object({
  five_hour: windowSchema,
  seven_day: windowSchema,
  seven_day_opus: windowSchema,
  seven_day_sonnet: windowSchema,
})

/** Per-model weekly bars, by the key the endpoint uses. */
const MODEL_WINDOWS = [
  ['seven_day_opus', 'opus'],
  ['seven_day_sonnet', 'sonnet'],
] as const

export type ClaudeOptions = {
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
  /** The discovered account's dir: `CLAUDE_CONFIG_DIR`, else `~/.claude` — as the CLI resolves it. */
  defaultConfigDir?: string
}

export function claudeAdapter(options: ClaudeOptions = {}): LimitsAdapter {
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? CLAUDE_TIMEOUT_MS
  const defaultDir = options.defaultConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')

  return async (account) => {
    const token = await readToken(join(account.configDir ?? defaultDir, '.credentials.json'), now())
    if (typeof token !== 'string') return token
    let response: Response
    try {
      response = await doFetch(CLAUDE_USAGE_URL, {
        headers: {
          authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          accept: 'application/json',
          'user-agent': 'cezar-push',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return unavailable('the Claude usage endpoint could not be reached')
    }
    if (response.status === 401 || response.status === 403) {
      return unavailable(`the Claude usage endpoint refused this login (HTTP ${response.status})`)
    }
    if (!response.ok) return unavailable(`the Claude usage endpoint answered HTTP ${response.status}`)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return unavailable('the Claude usage endpoint did not answer JSON')
    }
    return mapClaudeUsage(body)
  }
}

/** Maps the endpoint's body; exported for the fixture tests. */
export function mapClaudeUsage(body: unknown): LimitsReading {
  const parsed = usageSchema.safeParse(body)
  // Neither plan window present at all (not even as `null`) is drift, not "nothing used".
  if (!parsed.success || (parsed.data.five_hour === undefined && parsed.data.seven_day === undefined)) {
    return unavailable('the Claude usage endpoint answered in a shape this sidecar does not know')
  }
  const usage = parsed.data
  const windows: LimitWindow[] = []
  const add = (window: z.infer<typeof windowSchema>, rest: Omit<LimitWindow, 'usedPercent' | 'resetsAt'>) => {
    if (!window) return
    const resetsAt = window.resets_at ? toIso(window.resets_at) : undefined
    windows.push({ ...rest, usedPercent: window.utilization, ...(resetsAt ? { resetsAt } : {}) })
  }
  add(usage.five_hour, { kind: 'five_hour' })
  add(usage.seven_day, { kind: 'weekly' })
  for (const [key, model] of MODEL_WINDOWS) add(usage[key], { kind: 'weekly_model', model })
  return { status: 'ok', windows }
}

/** The token, or why there is none — a reason that never quotes the file. */
async function readToken(file: string, now: number): Promise<string | LimitsReading> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return unavailable('no Claude login found for this account')
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return unavailable('the Claude credentials file is not readable JSON')
  }
  const parsed = credentialsSchema.safeParse(json)
  if (!parsed.success) return unavailable('no Claude subscription login found for this account')
  const { accessToken, expiresAt } = parsed.data.claudeAiOauth
  if (expiresAt !== undefined && expiresAt <= now) {
    return unavailable('the Claude login has expired; the next claude run on this account renews it')
  }
  return accessToken
}

function toIso(value: string): string | undefined {
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}
