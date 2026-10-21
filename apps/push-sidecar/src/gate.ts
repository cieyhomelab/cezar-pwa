import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { GATE_KINDS, gateKey, type PushPayload } from '@cezar-pwa/shared'
import { z } from 'zod'

/**
 * Gate notifications: the software house's agents (`sh-notify` in cieyhomelab/sh-skills) tell the
 * operator that a gate waits for them on GitHub. `POST /m/push/gate` is for processes on the host,
 * never for a browser: nginx answers 404 for it, and the request must carry the token from
 * `STATE_DIR/gate-token`.
 */

/** `sh-notify`'s body. Strict: an extra key is a caller that means something this build does not. */
export const gateBody = z
  .object({
    gate: z.enum(GATE_KINDS),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    number: z.number().int().positive(),
    title: z.string().max(100),
    url: z.string().max(2048).startsWith('https://github.com/'),
  })
  .strict()

export type GateBody = z.infer<typeof gateBody>

export function gatePayload(body: GateBody): PushPayload {
  return { kind: 'gate', gate: body.gate, repo: body.repo, number: body.number, title: body.title, url: body.url }
}

/**
 * The token `sh-notify` sends in `X-Cezar-Push-Token`: 32 random bytes in hex, mode 0600, created
 * once and never rotated implicitly — a file someone put there first (the host's setup) is kept.
 */
export async function initGateToken(file: string): Promise<{ token: string; created: boolean }> {
  const existing = await readToken(file)
  if (existing !== undefined) return { token: existing, created: false }
  const token = randomBytes(32).toString('hex')
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  try {
    // `wx`: never overwrite a token another process wrote in the meantime.
    await writeFile(file, `${token}\n`, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const raced = await readToken(file)
    if (raced === undefined) throw new Error(`the gate token at ${file} is empty`)
    return { token: raced, created: false }
  }
  return { token, created: true }
}

async function readToken(file: string): Promise<string | undefined> {
  try {
    const token = (await readFile(file, 'utf8')).trim()
    if (token === '') throw new Error(`the gate token at ${file} is empty`)
    return token
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Constant time, and for any length: both sides are hashed to the same size first. */
export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(expected), digest(given))
}

/** An agent may call `sh-notify` twice in one pass; the same gate rings once in this window. */
export const GATE_DEDUP_MS = 10 * 60 * 1000

export type GateAlertsOptions = {
  /** `STATE_DIR/gate-alerts.json`: when each gate last rang, so a restart does not re-ring. */
  file: string
  notify: (payload: PushPayload) => Promise<number>
  log?: (message: string) => void
  now?: () => number
}

const memorySchema = z.record(z.string(), z.number())

/**
 * Rings a gate unless the same gate on the same issue or PR rang within `GATE_DEDUP_MS`. After the
 * window it may ring again: `blocked` added once more hours later is a new matter.
 *
 * The memory is saved BEFORE the push goes out, like the limit alerts: a failed push is never
 * retried into a second ring. Logs the gate, never the title.
 */
export class GateAlerts {
  private memory: Record<string, number> = {}
  private readonly options: GateAlertsOptions

  constructor(options: GateAlertsOptions) {
    this.options = options
  }

  /** A missing or unreadable file is an empty memory: at worst one extra notification. */
  async load(): Promise<void> {
    try {
      this.memory = memorySchema.parse(JSON.parse(await readFile(this.options.file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.options.log?.('gate alerts: memory unreadable, starting empty')
      }
      this.memory = {}
    }
  }

  async ring(body: GateBody): Promise<{ sent: number; deduplicated: boolean }> {
    const now = (this.options.now ?? Date.now)()
    for (const [key, at] of Object.entries(this.memory)) {
      if (now - at >= GATE_DEDUP_MS) delete this.memory[key]
    }
    const key = gateKey(body.gate, body.repo, body.number)
    if (this.memory[key] !== undefined) return { sent: 0, deduplicated: true }
    this.memory[key] = now
    try {
      await this.save()
    } catch {
      this.options.log?.('gate alerts: could not save the memory')
    }
    this.options.log?.(`gate alert: ${body.gate}`)
    try {
      return { sent: await this.options.notify(gatePayload(body)), deduplicated: false }
    } catch {
      this.options.log?.('gate alert: push failed')
      return { sent: 0, deduplicated: false }
    }
  }

  private async save(): Promise<void> {
    const file = this.options.file
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(this.memory, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, file)
  }
}
