import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Everything the sidecar reads from its environment (`deploy/systemd/cezar-push.service`). No
 * secret travels this way: the VAPID pair is a file in `STATE_DIR` (CLAUDE.md rule 6).
 */
export type Config = {
  host: string
  port: number
  /** Cezar on loopback. The live instance listens on 4322. */
  cezarUrl: string
  stateDir: string
  /** VAPID `sub`: a `mailto:` or `https:` contact the push service may use. */
  subject: string
  publicOrigin: string
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicOrigin = env.PUBLIC_ORIGIN ?? 'https://cezar.ciey.studio'
  const port = Number(env.PORT ?? 4330)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`PORT is not a port: ${env.PORT}`)
  const subject = env.VAPID_SUBJECT ?? publicOrigin
  if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error('VAPID_SUBJECT must be a mailto: or https:// URL')
  return {
    // Loopback only — nginx is the sole way in (REQUIREMENTS A5/A6).
    host: env.HOST ?? '127.0.0.1',
    port,
    cezarUrl: env.CEZAR_URL ?? 'http://127.0.0.1:4322',
    stateDir: env.STATE_DIR ?? join(homedir(), '.cezar-push'),
    subject,
    publicOrigin,
  }
}
