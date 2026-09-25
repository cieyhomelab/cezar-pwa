/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bypassesShell } from '../src/pwa/sw-routes.ts'

/**
 * CLAUDE.md rule 4: the service worker never touches `/api/**` or `/m/push/**`. #93 adds
 * `GET /m/push/limits`, whose reading must always be the sidecar's current one. The worker is not
 * run under Vitest, so its source is read from disk to pin that it registers nothing that could
 * cache a response beyond the shell's precache and the navigation fallback.
 */
const sw = readFileSync(resolve(import.meta.dirname, '../src/sw.ts'), 'utf8')
  // Comments explain what the worker does not do; only the code counts.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('the navigation fallback', () => {
  it.each([
    ['/m/push/limits', true],
    ['/m/push/vapid-public-key', true],
    ['/api/v1/health', true],
    ['/m/?key=abc', true],
    ['/m/limits', false],
    ['/m/p/cezar-pwa/runs/r1', false],
  ])('%s bypasses the shell: %s', (path, bypasses) => {
    expect(bypassesShell(path)).toBe(bypasses)
  })
})

describe('sw.ts', () => {
  it('registers no runtime caching strategy, so /m/push/limits is never cached', () => {
    expect(sw).not.toMatch(/workbox-strategies|workbox-expiration|caches\.open|respondWith/)
    expect(sw.match(/registerRoute\(/g)).toHaveLength(1)
    expect(sw).toContain('denylist: [...NAVIGATION_DENYLIST]')
  })
})
