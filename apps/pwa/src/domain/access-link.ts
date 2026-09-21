/**
 * Turning a pasted access link into the one navigation that can create a
 * session inside the installed app.
 *
 * ## Why this shape
 *
 * The gateway's unlock guard is `if ($arg_key = "…") { add_header Set-Cookie …;
 * return 302 https://$host$uri; }` (`docs/CEZAR_API.md` § 1a). Two consequences
 * decide everything here:
 *
 *  - **The return destination is the link's own path.** `$uri` is the path and
 *    nothing else — the whole query string is discarded on the way through, so
 *    a `?next=` parameter cannot exist. Sending the operator back to the app
 *    therefore means giving the key the app's *path*: `/m/`.
 *  - **The product must never hold the secret.** The key is the whole
 *    credential (the cookie's value is the same string), so it lives in this
 *    module's arguments and its return value and nowhere else: not in storage,
 *    not in a log, not in a query cache, and — once
 *    `features/auth/unlock.ts` has stripped it — not in the history entry
 *    either (R-AUTH-5, PRD § Access Control).
 *
 * The functions below are pure so this reasoning can be tested rather than
 * trusted (CLAUDE.md → "logika domenowa jako czyste funkcje w src/domain/").
 */

/** The parameter nginx's guard tests. */
export const ACCESS_KEY_PARAM = 'key'

/** Where the operator should land once the gateway has issued the session. */
export const RETURN_PATH = '/m/'

export type AccessLinkProblem =
  /** Nothing pasted. */
  | 'empty'
  /** Not parseable as a URL, even against the app's own origin. */
  | 'not-a-url'
  /** Points at some other host: sending the key there would leak it. */
  | 'foreign-origin'
  /** No `key` parameter, so the gateway would never set a cookie. */
  | 'missing-key'

export type AccessLinkResult =
  | { ok: true; url: string }
  | { ok: false; problem: AccessLinkProblem }

/**
 * Rewrite a pasted access link into `<origin>/m/?key=…`.
 *
 * Whatever path the operator's link carried is replaced by the app's own, and
 * every parameter but `key` is dropped — both because the gateway discards them
 * anyway and because the fewer things travel with the secret, the better.
 *
 * A bare path (`/x?key=…`) is accepted and resolved against `origin`: an
 * operator copying from a message may well paste only part of it. A link to
 * another host is refused outright rather than silently retargeted — the key
 * belongs to this instance and must not be sent anywhere else.
 */
export function buildUnlockUrl(
  pasted: string,
  options: { origin: string; returnPath?: string },
): AccessLinkResult {
  const trimmed = pasted.trim()
  if (trimmed === '') return { ok: false, problem: 'empty' }

  let parsed: URL
  try {
    parsed = new URL(trimmed, options.origin)
  } catch {
    return { ok: false, problem: 'not-a-url' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, problem: 'not-a-url' }
  }

  // Only an explicit foreign host is refused. A scheme-less paste
  // (`cezar.ciey.studio/?key=…`) resolves as a *path* on our own origin, which
  // is harmless and in fact still works: the path is discarded and only the key
  // is carried over. The secret therefore never travels anywhere but here.
  if (parsed.origin !== new URL(options.origin).origin) {
    return { ok: false, problem: 'foreign-origin' }
  }

  const key = rawParam(parsed.search, ACCESS_KEY_PARAM)
  if (key === null || key === '') return { ok: false, problem: 'missing-key' }

  // Spliced in raw, never through `URLSearchParams.set`: that re-encodes `/`,
  // `=`, `~` and `!` as `%2F`, `%3D`…, while nginx's `$arg_key = "…"` compares
  // the raw bytes of the query. A base64-style key would stop matching — which
  // is exactly how the first version of this failed on the device.
  const unlock = new URL(options.returnPath ?? RETURN_PATH, options.origin)
  return { ok: true, url: `${unlock.origin}${unlock.pathname}?${ACCESS_KEY_PARAM}=${key}` }
}

/**
 * The first value of `name` in a `?…` string, exactly as it appears — not
 * percent-decoded. nginx's `$arg_<name>` is likewise the first occurrence, raw.
 *
 * `search` comes from `URL`, so it is already what the browser would put on the
 * wire for the operator's own link: anything the URL parser had to escape is
 * escaped the same way here.
 */
function rawParam(search: string, name: string): string | null {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const eq = pair.indexOf('=')
    const pairName = eq === -1 ? pair : pair.slice(0, eq)
    if (pairName === name) return eq === -1 ? '' : pair.slice(eq + 1)
  }
  return null
}

/** Whether a `?…` string carries an access key — i.e. the gateway did not consume it. */
export function hasAccessKey(search: string): boolean {
  return new URLSearchParams(search).has(ACCESS_KEY_PARAM)
}

/**
 * The same URL with the access key removed, for `history.replaceState`.
 *
 * Reached only when the gateway did *not* redirect — had it consumed the key,
 * the browser would already be sitting on a clean URL.
 */
export function stripAccessKey(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(ACCESS_KEY_PARAM)
  // `?` with nothing after it is noise in the address bar and in history.
  // (`searchParams.size` would read better but only shipped in Safari 17; the
  // phones this targets can be older.)
  return url.searchParams.toString() === ''
    ? `${url.origin}${url.pathname}${url.hash}`
    : url.toString()
}
