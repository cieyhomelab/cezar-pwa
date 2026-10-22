import { describe, expect, it } from 'vitest'
import { isCezarNewerThanTested, TESTED_CEZAR_VERSION } from './cezar-compat.ts'

describe('isCezarNewerThanTested', () => {
  it.each([
    ['0.16.3', true],
    ['0.17.0', true],
    ['1.0.0', true],
    [TESTED_CEZAR_VERSION, false],
    ['0.11.1', false],
    ['0.12.0', false],
    ['0.13.0', false],
    ['0.14.0', false],
    ['0.15.0', false],
    ['0.15.1', false],
    ['0.15.2', false],
    ['0.16.0', false],
    ['0.16.1', false],
    // Cezar #1530: a source checkout answers `<release>-dev`, which is that release.
    [`${TESTED_CEZAR_VERSION}-dev`, false],
    ['0.16.3-dev', true],
    ['0.15', false],
    ['', false],
    [undefined, false],
    [null, false],
    ['nonsense', false],
  ])('%s → %s', (live, expected) => {
    expect(isCezarNewerThanTested(live)).toBe(expected)
  })
})
