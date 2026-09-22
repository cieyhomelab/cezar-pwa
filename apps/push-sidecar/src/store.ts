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

/** Only the top-level shape: each entry is checked on its own, so one bad entry cannot stop the service. */
const fileSchema = z.object({ subscriptions: z.array(z.unknown()) })

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
  /** Where `load()` sets aside entries that no longer validate. */
  readonly rejectedFile: string
  private subscriptions: Stored[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
    this.rejectedFile = `${file.replace(/\.json$/, '')}.rejected.json`
  }

  /**
   * A missing file is an empty store; an unreadable one is an error — never silently wiped. An
   * entry that no longer validates (a hand edit, a tightened push-host allowlist) is set aside in
   * `rejectedFile` and skipped, so the other devices keep their notifications.
   * @returns how many entries were set aside.
   */
  async load(): Promise<number> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
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
    return rejected.length
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
   * Serialised: two quick writes must land in order, and the last one wins. A failed write rejects
   * only its own caller; memory stays ahead of the disk until the next save writes all of it.
   */
  private save(): Promise<void> {
    const body = `${JSON.stringify({ subscriptions: this.subscriptions }, null, 2)}\n`
    this.writing = this.writing.catch(() => {}).then(() => writeAtomic(this.file, body))
    return this.writing
  }

  /** Merged into what an earlier start set aside, so nothing rejected is ever lost. */
  private async setAside(entries: unknown[]): Promise<void> {
    let kept: unknown[] = []
    try {
      kept = z.array(z.unknown()).parse(JSON.parse(await readFile(this.rejectedFile, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const seen = new Set(kept.map((entry) => JSON.stringify(entry)))
    const added = entries.filter((entry) => !seen.has(JSON.stringify(entry)))
    if (added.length > 0) await writeAtomic(this.rejectedFile, `${JSON.stringify([...kept, ...added], null, 2)}\n`)
  }
}

/** Temp file renamed over the old one, so a crash mid-write leaves the previous file whole. */
async function writeAtomic(file: string, body: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, body, { mode: 0o600 })
  await rename(temp, file)
}
