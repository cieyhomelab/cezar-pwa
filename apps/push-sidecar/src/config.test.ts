import { describe, expect, it } from 'vitest'
import { readConfig } from './config.ts'

const ORIGIN = 'https://cezar.example.test'

describe('readConfig', () => {
  describe('PUBLIC_ORIGIN', () => {
    it.each([
      ['a host', ORIGIN],
      ['a host and a port', 'https://cezar.example.test:8443'],
    ])('accepts %s', (_, value) => {
      expect(readConfig({ PUBLIC_ORIGIN: value }).publicOrigin).toBe(value)
    })

    it.each([
      ['missing', undefined, 'PUBLIC_ORIGIN is not set'],
      ['empty', '', 'PUBLIC_ORIGIN is not set'],
      ['not a URL', 'cezar.example.test', 'PUBLIC_ORIGIN is not a URL'],
      ['plain http', 'http://cezar.example.test', 'must be an https:// origin'],
      ['a trailing slash', `${ORIGIN}/`, `did you mean ${ORIGIN}?`],
      ['a path', `${ORIGIN}/m/`, `did you mean ${ORIGIN}?`],
      ['a query', `${ORIGIN}?key=x`, `did you mean ${ORIGIN}?`],
      ['the default port spelled out', `${ORIGIN}:443`, `did you mean ${ORIGIN}?`],
      ['an upper-case host', 'https://Cezar.Example.Test', `did you mean ${ORIGIN}?`],
    ])('refuses %s', (_, value, message) => {
      expect(() => readConfig({ PUBLIC_ORIGIN: value })).toThrow(message)
    })
  })

  it('defaults the VAPID subject to the public origin', () => {
    expect(readConfig({ PUBLIC_ORIGIN: ORIGIN }).subject).toBe(ORIGIN)
  })

  it('still refuses a bad PORT', () => {
    expect(() => readConfig({ PUBLIC_ORIGIN: ORIGIN, PORT: 'nonsense' })).toThrow('PORT is not a port')
  })

  describe('the limits collector', () => {
    it('reads Codex and not Claude every five minutes by default', () => {
      expect(readConfig({ PUBLIC_ORIGIN: ORIGIN }).limits).toEqual({ claude: false, codex: true, intervalMs: 300_000 })
    })

    it.each([
      [{ LIMITS_CLAUDE: '1', LIMITS_CODEX: '0' }, { claude: true, codex: false }],
      [{ LIMITS_CLAUDE: 'on', LIMITS_CODEX: 'off' }, { claude: true, codex: false }],
      [{ LIMITS_CLAUDE: 'TRUE', LIMITS_CODEX: 'false' }, { claude: true, codex: false }],
      [{ LIMITS_CLAUDE: '', LIMITS_CODEX: '' }, { claude: false, codex: true }],
    ])('reads the switches %o', (env, expected) => {
      expect(readConfig({ PUBLIC_ORIGIN: ORIGIN, ...env }).limits).toMatchObject(expected)
    })

    it('takes a poll interval in seconds', () => {
      expect(readConfig({ PUBLIC_ORIGIN: ORIGIN, LIMITS_POLL_SECONDS: '600' }).limits.intervalMs).toBe(600_000)
    })

    it.each([
      [{ LIMITS_CLAUDE: 'maybe' }, 'LIMITS_CLAUDE must be on or off'],
      [{ LIMITS_POLL_SECONDS: '10' }, 'at least 60'],
      [{ LIMITS_POLL_SECONDS: '5m' }, 'at least 60'],
    ])('refuses %o', (env, message) => {
      expect(() => readConfig({ PUBLIC_ORIGIN: ORIGIN, ...env })).toThrow(message)
    })
  })
})
