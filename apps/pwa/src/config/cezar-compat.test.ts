import { describe, expect, it } from 'vitest'
import { isCezarNewerThanTested, TESTED_CEZAR_VERSION } from './cezar-compat.ts'

describe('isCezarNewerThanTested', () => {
  it.each([
    ['0.12.1', true],
    ['0.13.0', true],
    ['1.0.0', true],
    [TESTED_CEZAR_VERSION, false],
    ['0.11.1', false],
    ['0.11.9', false],
    ['0.12', false],
    ['', false],
    [undefined, false],
    [null, false],
    ['nonsense', false],
  ])('%s → %s', (live, expected) => {
    expect(isCezarNewerThanTested(live)).toBe(expected)
  })
})
