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
})
