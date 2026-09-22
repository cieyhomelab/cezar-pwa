import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

/**
 * The push services a subscription may point at. The sidecar POSTs to whatever endpoint it is
 * given, so an open endpoint field would make it a request cannon for anyone past the gate.
 * Apple is the target (iOS 16.4+); the others are what a browser on the operator's laptop would
 * hand out, and cost nothing to accept.
 */
const PUSH_SERVICE_HOSTS = [
  /\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
]

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return url.protocol === 'https:' && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
}

/** `PushSubscription.toJSON()`, as the PWA posts it. Unknown fields are dropped, not refused. */
export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceEndpoint, 'not a known push service endpoint'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
})

export type Subscription = z.infer<typeof subscriptionSchema>

type Stored = Subscription & { createdAt: string }

const storedSchema = subscriptionSchema.extend({ createdAt: z.string() })

/** Only the top-level shape; entries are checked one by one so a bad one cannot sink the rest. */
const fileSchema = z.object({ subscriptions: z.array(z.unknown()) })

/** Where `load()` sets aside entries that no longer validate: `subscriptions.json` → `subscriptions.rejected.json`. */
export function rejectedFileOf(file: string): string {
  return file.endsWith('.json') ? `${file.slice(0, -'.json'.length)}.rejected.json` : `${file}.rejected`
}

/**
 * One operator, a handful of devices. The cap keeps a misbehaving client from growing the file
 * without bound; the oldest subscription makes room.
 */
export const MAX_SUBSCRIPTIONS = 20

/**
 * Subscriptions in one JSON file (REQUIREMENTS § 6: no database), mode 0600 — an endpoint plus
 * its keys is enough to push to the device. Every write goes to a temp file and is renamed over
 * the old one, so a crash mid-write leaves the previous file whole.
 */
export class SubscriptionStore {
  private readonly file: string
  private subscriptions: Stored[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  /**
   * A missing file is an empty store; one that is not JSON or not `{ subscriptions: [] }` is an
   * error — never silently wiped. An entry that no longer validates (a hand edit, a push host
   * dropped from the allowlist) is copied to {@link rejectedFileOf} before anything can rewrite
   * the file, and the rest load: one bad device must not keep every other one from being served.
   *
   * @returns how many entries were set aside — a count, never the entries (CLAUDE.md rule 6).
   */
  async load(): Promise<{ rejected: number }> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rejected: 0 }
      throw error
    }
    const valid: Stored[] = []
    const rejected: unknown[] = []
    for (const entry of fileSchema.parse(JSON.parse(raw)).subscriptions) {
      const parsed = storedSchema.safeParse(entry)
      if (parsed.success) valid.push(parsed.data)
      else rejected.push(entry)
    }
    if (rejected.length > 0) await this.setAside(rejected)
    this.subscriptions = valid
    return { rejected: rejected.length }
  }

  list(): readonly Subscription[] {
    return this.subscriptions
  }

  find(endpoint: string): Subscription | undefined {
    return this.subscriptions.find((entry) => entry.endpoint === endpoint)
  }

  /** Insert or refresh, keyed on the endpoint: re-enabling on the same device is not a second one. */
  async upsert(subscription: Subscription, now = new Date()): Promise<void> {
    const rest = this.subscriptions.filter((entry) => entry.endpoint !== subscription.endpoint)
    const next = [...rest, { ...subscription, createdAt: now.toISOString() }]
    this.subscriptions = next.slice(-MAX_SUBSCRIPTIONS)
    await this.save()
  }

  /** @returns whether it was there. */
  async remove(endpoint: string): Promise<boolean> {
    const before = this.subscriptions.length
    this.subscriptions = this.subscriptions.filter((entry) => entry.endpoint !== endpoint)
    if (this.subscriptions.length === before) return false
    await this.save()
    return true
  }

  /**
   * Every write is the whole list, so a failed one is repaired by the next: memory keeps the
   * change, the caller sees the error, and the next save lands both. The chain swallows the
   * failure for the writes queued behind it — otherwise one ENOSPC would reject every later save.
   */
  private save(): Promise<void> {
    const body = `${JSON.stringify({ subscriptions: this.subscriptions }, null, 2)}\n`
    // Serialised: two quick writes must land in order, and the last one wins.
    const write = this.writing.catch(() => {}).then(() => this.write(this.file, body))
    this.writing = write
    return write
  }

  /**
   * Merged into what an earlier start set aside, so a second rejection does not overwrite the
   * first. An existing side file that does not parse is an error, like the main one.
   */
  private async setAside(entries: unknown[]): Promise<void> {
    const file = rejectedFileOf(this.file)
    let kept: unknown[] = []
    try {
      kept = fileSchema.parse(JSON.parse(await readFile(file, 'utf8'))).subscriptions
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const seen = new Set(kept.map((entry) => JSON.stringify(entry)))
    const merged = [...kept, ...entries.filter((entry) => !seen.has(JSON.stringify(entry)))]
    await this.write(file, `${JSON.stringify({ subscriptions: merged }, null, 2)}\n`)
  }

  private async write(file: string, body: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, body, { mode: 0o600 })
    await rename(temp, file)
  }
}
