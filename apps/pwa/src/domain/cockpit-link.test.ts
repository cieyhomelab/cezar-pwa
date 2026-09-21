import { describe, expect, it } from 'vitest'
import { cockpitChangesPath, cockpitTaskPath } from './cockpit-link.ts'

describe('cockpitTaskPath', () => {
  it.each([
    ['cezar-pwa', 'e5eb57e0', '/p/cezar-pwa/tasks/e5eb57e0'],
    ['a b', 'x/y', '/p/a%20b/tasks/x%2Fy'],
    ['p?q', '#1', '/p/p%3Fq/tasks/%231'],
  ])('%s / %s', (projectId, runId, expected) => {
    expect(cockpitTaskPath(projectId, runId)).toBe(expected)
  })

  it('is outside the app: never under /m/', () => {
    expect(cockpitTaskPath('m', 'r')).not.toMatch(/^\/m\//)
  })
})

describe('cockpitChangesPath', () => {
  it('is the task path plus the Changes tab', () => {
    expect(cockpitChangesPath('cezar-pwa', 'e5eb57e0')).toBe('/p/cezar-pwa/tasks/e5eb57e0/changes')
  })
})
