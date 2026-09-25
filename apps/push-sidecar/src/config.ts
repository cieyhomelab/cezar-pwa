import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LIMIT_THRESHOLD } from '@cezar-pwa/shared'

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
  /** The usage-limits collector (#92), `GET /m/push/limits`. */
  limits: {
    /** Off by default: it reads the OAuth token and calls Anthropic's undocumented usage endpoint. */
    claude: boolean
    /** On by default; reports `codex not installed` when the binary is missing. */
    codex: boolean
    /** `LIMITS_CODEX_BIN`: the Codex binary, when it is not `codex` on `PATH` or in `~/.local/bin`. */
    codexBin: string | undefined
    intervalMs: number
    /**
     * `LIMITS_NOTIFY_PERCENT` (#94): a window at or past this share, or exhausted, is pushed once
     * while tasks are queued or running. 90 by default.
     */
    notifyPercent: number
  }
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
    limits: {
      claude: readSwitch('LIMITS_CLAUDE', env.LIMITS_CLAUDE, false),
      codex: readSwitch('LIMITS_CODEX', env.LIMITS_CODEX, true),
      codexBin: env.LIMITS_CODEX_BIN || undefined,
      intervalMs: readPollSeconds(env.LIMITS_POLL_SECONDS) * 1000,
      notifyPercent: readNotifyPercent(env.LIMITS_NOTIFY_PERCENT),
    },
  }
}

function readSwitch(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  if (/^(1|true|on|yes)$/i.test(value)) return true
  if (/^(0|false|off|no)$/i.test(value)) return false
  throw new Error(`${name} must be on or off (1/0, true/false), got: ${value}`)
}

/** Five minutes by default; never under one, so a typo cannot hammer the providers. */
function readPollSeconds(value: string | undefined): number {
  if (value === undefined || value === '') return 300
  const seconds = Number(value)
  if (!Number.isInteger(seconds) || seconds < 60) {
    throw new Error(`LIMITS_POLL_SECONDS must be a whole number of seconds, at least 60, got: ${value}`)
  }
  return seconds
}

/** A whole percent from 1 to 100; 100 means "only when exhausted". */
function readNotifyPercent(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_LIMIT_THRESHOLD
  const percent = Number(value)
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new Error(`LIMITS_NOTIFY_PERCENT must be a whole percent from 1 to 100, got: ${value}`)
  }
  return percent
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
