import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import webpush from 'web-push'
import { z } from 'zod'

/**
 * The VAPID key pair: generated once on the host (`cezar-push init`), kept in
 * `~/.cezar-push/vapid.json` with mode 0600, never in the repo (CLAUDE.md rule 6).
 *
 * Never rotated implicitly: every subscription is bound to the public key it was made with, so a
 * new pair would silently orphan every device.
 */
const vapidSchema = z.object({ publicKey: z.string().min(1), privateKey: z.string().min(1) })

export type VapidKeys = z.infer<typeof vapidSchema>

export async function loadVapid(file: string): Promise<VapidKeys> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`no VAPID keys at ${file} — run \`cezar-push init\` once`)
    }
    throw error
  }
  return vapidSchema.parse(JSON.parse(raw))
}

/** Creates the pair unless one exists. @returns the keys, and whether they are new. */
export async function initVapid(file: string): Promise<{ keys: VapidKeys; created: boolean }> {
  try {
    return { keys: await loadVapid(file), created: false }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('no VAPID keys')) throw error
  }
  const keys = webpush.generateVAPIDKeys()
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  // `wx`: never overwrite a pair another process wrote in the meantime.
  await writeFile(file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return { keys, created: true }
}
