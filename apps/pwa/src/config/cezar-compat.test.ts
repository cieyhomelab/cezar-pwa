import { describe, expect, it } from 'vitest'
import { isCezarNewerThanTested, TESTED_CEZAR_VERSION } from './cezar-compat.ts'

describe('isCezarNewerThanTested', () => {
  it.each([
    ['0.11.2', true],
    ['0.12.0', true],
    ['1.0.0', true],
    [TESTED_CEZAR_VERSION, false],
    ['0.11.0', false],
    ['0.10.9', false],
    ['0.11', false],
    ['', false],
    [undefined, false],
    [null, false],
    ['nonsense', false],
  ])('%s → %s', (live, expected) => {
    expect(isCezarNewerThanTested(live)).toBe(expected)
  })
})
