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
  const publicOrigin = readPublicOrigin(env.PUBLIC_ORIGIN)
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

/**
 * The one origin writes may come from. Required, with no default: a default is some other
 * deployment's host, and the sidecar would start cleanly and then refuse every write with 403.
 * It must already be in the exact form a browser sends in `Origin` — `app.ts` compares strings —
 * so a trailing slash, a path or a default port is refused rather than quietly never matching.
 */
function readPublicOrigin(value: string | undefined): string {
  if (!value) throw new Error('PUBLIC_ORIGIN is not set (the https:// origin the app is served from)')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`PUBLIC_ORIGIN is not a URL: ${value}`)
  }
  if (url.protocol !== 'https:') throw new Error(`PUBLIC_ORIGIN must be an https:// origin, got: ${value}`)
  if (url.origin !== value) {
    throw new Error(
      `PUBLIC_ORIGIN must be a bare origin (scheme, host, optional port), got: ${value} — did you mean ${url.origin}?`,
    )
  }
  return value
}
