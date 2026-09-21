import { describe, expect, it } from 'vitest'
import { parseThemePreference, resolveTheme } from './theme.ts'

describe('parseThemePreference', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['system', 'system'],
    [null, 'system'],
    [undefined, 'system'],
    ['', 'system'],
    ['Dark', 'system'],
    ['sepia', 'system'],
    [1, 'system'],
  ])('%j → %s', (raw, expected) => {
    expect(parseThemePreference(raw)).toBe(expected)
  })
})

describe('resolveTheme', () => {
  it.each([
    ['system', false, 'dark'],
    ['system', true, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
    ['light', false, 'light'],
    ['light', true, 'light'],
  ] as const)('%s with the system on light=%s → %s', (preference, systemLight, expected) => {
    expect(resolveTheme(preference, systemLight)).toBe(expected)
  })
})
