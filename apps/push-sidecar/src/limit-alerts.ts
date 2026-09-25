import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { limitCrossings, type LimitMemory, type ProviderLimits, type PushPayload } from '@cezar-pwa/shared'
import { z } from 'zod'

export type LimitAlertsOptions = {
  /** `STATE_DIR/limit-alerts.json`: what has been announced per window, so a restart does not re-ring. */
  file: string
  /** `LIMITS_NOTIFY_PERCENT`. */
  threshold: number
  /** Whether any task is queued or running — the watcher's view of the runs index. */
  busy: () => boolean
  notify: (payload: PushPayload) => Promise<unknown> | void
  log?: (message: string) => void
  now?: () => Date
}

const memorySchema = z.record(
  z.string(),
  z.object({ level: z.enum(['near', 'exhausted']), resetsAt: z.string().optional() }),
)

/**
 * #94: after each limits poll, push once when a window enters the threshold or runs out while
 * tasks are queued or running (`limitCrossings` in `@cezar-pwa/shared` is the rule).
 *
 * The memory is saved BEFORE the push goes out, like the watcher records a status before it
 * notifies: a failed push is never retried into a second ring. Logs a count and a level, never an
 * account's numbers.
 */
export class LimitAlerts {
  private memory: Record<string, LimitMemory> = {}
  private readonly options: LimitAlertsOptions

  constructor(options: LimitAlertsOptions) {
    this.options = options
  }

  /** A missing or unreadable file is an empty memory: at worst one extra notification. */
  async load(): Promise<void> {
    try {
      this.memory = memorySchema.parse(JSON.parse(await readFile(this.options.file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.options.log?.('limit alerts: memory unreadable, starting empty')
      }
      this.memory = {}
    }
  }

  async check(providers: readonly ProviderLimits[]): Promise<void> {
    const { notify, memory } = limitCrossings({
      providers,
      memory: this.memory,
      threshold: this.options.threshold,
      busy: this.options.busy(),
      now: (this.options.now ?? (() => new Date()))(),
    })
    const changed = JSON.stringify(memory) !== JSON.stringify(this.memory)
    this.memory = memory
    if (changed) {
      try {
        await this.save()
      } catch {
        this.options.log?.('limit alerts: could not save the memory')
      }
    }
    for (const payload of notify) {
      this.options.log?.(`limit alert: ${payload.provider} window ${payload.level}`)
      try {
        await this.options.notify(payload)
      } catch {
        this.options.log?.('limit alert: push failed')
      }
    }
  }

  /** For tests and `/health`-style inspection: what is remembered now. */
  remembered(): Readonly<Record<string, LimitMemory>> {
    return this.memory
  }

  private async save(): Promise<void> {
    const file = this.options.file
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(this.memory, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, file)
  }
}
