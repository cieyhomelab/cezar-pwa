import { healthResponseSchema, runsIndexResponseSchema } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import liveHealth from '../fixtures/health.live-0.11.0.json'
import liveRunsIndex from '../fixtures/runs-index.live-0.11.0.json'
import runsIndex from '../fixtures/runs-index.json'

/**
 * The fixtures the screens are tested against must be shapes the server can
 * actually send (CLAUDE.md → "testy kontraktowe"). Two kinds:
 *
 *  - `*.live-<version>.json` — captured from the instance on the VPS, so a
 *    failure here means the vendored contract no longer describes the server
 *    (re-sync it: `npm run sync:contract <sha>`).
 *  - the hand-written ones — every status and edge the list must render, which
 *    the live instance rarely holds all at once. A failure here means the
 *    fixture drifted into a shape the tests may pass on and production never
 *    sends.
 *
 * The schemas are used ONLY here. At runtime the app does not parse responses
 * with them: they are closed enums, and the vocabulary is append-only
 * (CLAUDE.md rule 5) — a status added upstream must degrade one row, not fail
 * the whole list.
 */
describe('contract fixtures', () => {
  it.each([
    ['live health', healthResponseSchema, liveHealth],
    ['live runs-index', runsIndexResponseSchema, liveRunsIndex],
    ['hand-written runs-index', runsIndexResponseSchema, runsIndex],
  ] as const)('%s matches the vendored schema', (_name, schema, fixture) => {
    const result = schema.safeParse(fixture)
    expect(result.error?.issues ?? []).toEqual([])
  })
})
