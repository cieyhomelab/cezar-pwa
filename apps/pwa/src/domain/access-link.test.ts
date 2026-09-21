import { describe, expect, it } from 'vitest'
import {
  type AccessLinkProblem,
  buildUnlockUrl,
  hasAccessKey,
  stripAccessKey,
} from './access-link.ts'

const ORIGIN = 'https://cezar.ciey.studio'

describe('buildUnlockUrl', () => {
  const accepted: Array<[name: string, pasted: string, expected: string]> = [
    [
      'the plain access link',
      'https://cezar.ciey.studio/?key=s3cret',
      'https://cezar.ciey.studio/m/?key=s3cret',
    ],
    [
      'a link to some other path — the path is ours to choose',
      'https://cezar.ciey.studio/p/proj/runs/abc?key=s3cret',
      'https://cezar.ciey.studio/m/?key=s3cret',
    ],
    [
      'a bare path, resolved against our own origin',
      '/?key=s3cret',
      'https://cezar.ciey.studio/m/?key=s3cret',
    ],
    [
      'whitespace around a pasted link',
      '  https://cezar.ciey.studio/?key=s3cret\n',
      'https://cezar.ciey.studio/m/?key=s3cret',
    ],
    [
      'other parameters, which the gateway discards anyway',
      'https://cezar.ciey.studio/?utm=mail&key=s3cret&next=/m/',
      'https://cezar.ciey.studio/m/?key=s3cret',
    ],
    [
      'a key needing encoding',
      'https://cezar.ciey.studio/?key=a%2Fb%2Bc',
      'https://cezar.ciey.studio/m/?key=a%2Fb%2Bc',
    ],
    [
      'a fragment, which never reaches the server',
      'https://cezar.ciey.studio/?key=s3cret#top',
      'https://cezar.ciey.studio/m/?key=s3cret',
    ],
    [
      'a host pasted without its scheme — it parses as a path, and the path is discarded anyway',
      'cezar.ciey.studio/?key=s3cret',
      'https://cezar.ciey.studio/m/?key=s3cret',
    ],
  ]

  it.each(accepted)('accepts %s', (_name, pasted, expected) => {
    const result = buildUnlockUrl(pasted, { origin: ORIGIN })
    expect(result).toEqual({ ok: true, url: expected })
  })

  const rejected: Array<[name: string, pasted: string, problem: AccessLinkProblem]> = [
    ['nothing', '', 'empty'],
    ['whitespace only', '   ', 'empty'],
    ['prose', 'oto twój link', 'missing-key'],
    ['a non-http scheme', 'javascript:alert(1)', 'not-a-url'],
    ['another host', 'https://evil.example/?key=s3cret', 'foreign-origin'],
    ['the right host on the wrong port', 'https://cezar.ciey.studio:8443/?key=s3cret', 'foreign-origin'],
    ['a link with no key at all', 'https://cezar.ciey.studio/m/', 'missing-key'],
    ['an empty key', 'https://cezar.ciey.studio/?key=', 'missing-key'],
  ]

  it.each(rejected)('rejects %s', (_name, pasted, problem) => {
    expect(buildUnlockUrl(pasted, { origin: ORIGIN })).toEqual({ ok: false, problem })
  })

  // nginx's `$arg_key = "…"` compares raw query bytes. Any re-encoding of the
  // key — `/` → `%2F`, `=` → `%3D` — makes a correct key fail to match, which
  // is what broke unlocking on the device on 2026-09-21.
  it.each([
    ['base64 with slash, plus and padding', 'Zm9v/YmFy+cXV4=='],
    ['base64url', 'Zm9v_YmFy-cXV4'],
    ['tilde and bang', 'x~y!z*'],
    ['already percent-encoded', 'a%2Fb%2Bc'],
    ['an embedded equals sign', 'a=b=c'],
    ['hex', '9f86d081884c7d659a2feaa0c55ad015'],
  ])('sends a %s key byte-for-byte as pasted', (_name, key) => {
    const result = buildUnlockUrl(`https://cezar.ciey.studio/?key=${key}`, { origin: ORIGIN })
    expect(result).toEqual({ ok: true, url: `https://cezar.ciey.studio/m/?key=${key}` })
  })

  it('takes the first key when a link carries two, as nginx does', () => {
    expect(
      buildUnlockUrl('https://cezar.ciey.studio/?key=first&key=second', { origin: ORIGIN }),
    ).toEqual({ ok: true, url: 'https://cezar.ciey.studio/m/?key=first' })
  })

  it('does not mistake a parameter merely ending in "key" for the key', () => {
    expect(
      buildUnlockUrl('https://cezar.ciey.studio/?apikey=nope', { origin: ORIGIN }),
    ).toEqual({ ok: false, problem: 'missing-key' })
  })

  it('never sends the key anywhere but our own origin', () => {
    // The guardrail this whole module exists for: a paste that points elsewhere
    // must not be "helpfully" retargeted, because the retarget would carry the
    // secret along.
    const result = buildUnlockUrl('https://evil.example/?key=s3cret', { origin: ORIGIN })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('s3cret')
  })

  it('honours a caller-chosen return path', () => {
    expect(
      buildUnlockUrl('https://cezar.ciey.studio/?key=s3cret', {
        origin: ORIGIN,
        returnPath: '/m/run/p/1',
      }),
    ).toEqual({ ok: true, url: 'https://cezar.ciey.studio/m/run/p/1?key=s3cret' })
  })
})

describe('hasAccessKey', () => {
  it.each([
    ['?key=s3cret', true],
    ['?a=1&key=s3cret', true],
    ['?key=', true], // present but empty: the gateway still did not consume it
    ['', false],
    ['?other=1', false],
  ])('reads %s as %s', (search, expected) => {
    expect(hasAccessKey(search)).toBe(expected)
  })
})

describe('stripAccessKey', () => {
  it('removes the key and the now-empty query', () => {
    expect(stripAccessKey('https://cezar.ciey.studio/m/?key=s3cret')).toBe(
      'https://cezar.ciey.studio/m/',
    )
  })

  it('keeps other parameters and the fragment', () => {
    expect(stripAccessKey('https://cezar.ciey.studio/m/?key=s3cret&tab=runs#x')).toBe(
      'https://cezar.ciey.studio/m/?tab=runs#x',
    )
  })

  it('leaves a URL without a key alone', () => {
    expect(stripAccessKey('https://cezar.ciey.studio/m/')).toBe('https://cezar.ciey.studio/m/')
  })
})
