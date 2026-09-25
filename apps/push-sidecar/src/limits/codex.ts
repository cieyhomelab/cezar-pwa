import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { LimitWindow, LimitWindowKind } from '@cezar-pwa/shared'
import { z } from 'zod'
import { unavailable, type LimitsAccount, type LimitsAdapter, type LimitsReading } from './types.ts'

/**
 * Codex (ChatGPT plan) windows through the official app-server: spawn `codex app-server`, speak
 * its JSON-RPC over stdio (one JSON object per line), `initialize`, then
 * `account/rateLimits/read`. No credential is read here — Codex answers from its own login — and
 * the read spends no quota.
 */
export const CODEX_TIMEOUT_MS = 15_000

/**
 * Windows are told apart by their length, never by `primary`/`secondary`: the 5-hour row is
 * sometimes missing, and then the weekly one is `primary` (#92). A length this copy does not
 * know is left out rather than guessed.
 */
const KIND_BY_MINUTES: Record<number, LimitWindowKind> = { 300: 'five_hour', 10_080: 'weekly' }

const windowSchema = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().nullish(),
    /** Unix seconds. */
    resetsAt: z.number().nullish(),
  })
  .nullish()

const rateLimitsResultSchema = z.object({
  rateLimits: z.object({ primary: windowSchema, secondary: windowSchema }).nullish(),
})

export type CodexOptions = {
  /** The binary; `codex` on `PATH` by default. */
  command?: string
  timeoutMs?: number
}

export function codexAdapter(options: CodexOptions = {}): LimitsAdapter {
  const command = options.command ?? 'codex'
  const timeoutMs = options.timeoutMs ?? CODEX_TIMEOUT_MS
  return (account) => readCodex(command, account, timeoutMs)
}

/** Maps a `account/rateLimits/read` result; exported for the fixture tests. */
export function mapCodexResult(result: unknown): LimitsReading {
  const parsed = rateLimitsResultSchema.safeParse(result)
  if (!parsed.success) return unavailable('codex answered in a shape this sidecar does not know')
  const limits = parsed.data.rateLimits
  if (!limits) return unavailable('codex reports no plan limits for this login')
  const windows: LimitWindow[] = []
  for (const window of [limits.primary, limits.secondary]) {
    const kind = window?.windowDurationMins == null ? undefined : KIND_BY_MINUTES[window.windowDurationMins]
    if (!window || !kind || windows.some((w) => w.kind === kind)) continue
    windows.push({
      kind,
      usedPercent: window.usedPercent,
      ...(window.resetsAt == null ? {} : { resetsAt: new Date(window.resetsAt * 1000).toISOString() }),
    })
  }
  return { status: 'ok', windows }
}

type RpcMessage = { id?: unknown; result?: unknown; error?: { message?: unknown } }

function readCodex(command: string, account: LimitsAccount, timeoutMs: number): Promise<LimitsReading> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(account.configDir ? { CODEX_HOME: account.configDir } : {}) }
    const child = spawn(command, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
    const lines = createInterface({ input: child.stdout })
    let settled = false
    // Every path out goes through here, so the child never outlives the read.
    const finish = (reading: LimitsReading) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      lines.close()
      child.stdin.destroy()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      resolve(reading)
    }
    const timer = setTimeout(() => finish(unavailable('codex did not answer in time')), timeoutMs)
    const send = (message: object) => {
      if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    child.on('error', (error: NodeJS.ErrnoException) =>
      finish(unavailable(error.code === 'ENOENT' ? 'codex not installed' : 'codex could not be started')),
    )
    child.on('exit', () => finish(unavailable('codex exited before answering')))
    // An EPIPE from a child that died early is reported by `exit`, not thrown.
    child.stdin.on('error', () => {})

    lines.on('line', (line) => {
      let message: RpcMessage
      try {
        message = JSON.parse(line) as RpcMessage
      } catch {
        return
      }
      if (message.id === 0) {
        if (message.error) return finish(unavailable('codex refused the handshake'))
        send({ method: 'initialized', params: {} })
        send({ method: 'account/rateLimits/read', id: 1 })
      } else if (message.id === 1) {
        if (message.error) return finish(unavailable(rpcReason(message.error.message)))
        finish(mapCodexResult(message.result))
      }
      // Anything else is a notification this read does not need.
    })

    send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'cezar-push', title: 'cezar-push', version: '0' } } })
  })
}

/** Codex's own error text, trimmed: it names the problem ("not logged in") and holds no secret. */
function rpcReason(message: unknown): string {
  const text = typeof message === 'string' ? message.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  return text ? `codex: ${text}` : 'codex refused the limits read'
}
