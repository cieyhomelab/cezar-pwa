import {
  apiRunSchema,
  automationLogResponseSchema,
  automationsResponseSchema,
  changesPayloadSchema,
  githubPrMergeStateResponseSchema,
  groupResponseSchema,
  healthResponseSchema,
  runEventSchema,
  runHistoryContextSchema,
  runHistoryPageSchema,
  runsIndexResponseSchema,
} from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import automationLog from '../fixtures/automation-log.json'
import automations from '../fixtures/automations.json'
import liveChangesRepointed from '../fixtures/changes-repointed.live-0.11.0.json'
import liveChanges from '../fixtures/changes.live-0.11.0.json'
import group from '../fixtures/group.json'
import liveHealth from '../fixtures/health.live-0.11.0.json'
import liveHistoryContext from '../fixtures/history-context.live-0.11.0.json'
import liveHistory from '../fixtures/history.live-0.11.0.json'
import liveMergeState from '../fixtures/merge-state.live-0.11.1.json'
import mergeState from '../fixtures/merge-state.json'
import liveRun from '../fixtures/run.live-0.11.0.json'
import recording from '../fixtures/transcript.ndjson?raw'
import liveRunsIndex from '../fixtures/runs-index.live-0.11.0.json'
import runsIndex from '../fixtures/runs-index.json'

/**
 * The fixtures the screens are tested against must be shapes the server can
 * actually send (CLAUDE.md → "contract tests"). Two kinds:
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
    ['live run', apiRunSchema, liveRun],
    ['live history page', runHistoryPageSchema, liveHistory],
    ['live history context', runHistoryContextSchema, liveHistoryContext],
    // S-09. The first is this repo's own task, trimmed to three of its files (stat recomputed).
    ['live changes', changesPayloadSchema, liveChanges],
    ['live changes, repointed and empty', changesPayloadSchema, liveChangesRepointed],
    // S-21. Hand-written: no run on the host carries a groupId (0 of 41 when #71 was filed).
    ['hand-written variant group', groupResponseSchema, group],
    // S-20. Hand-written: no project on the host has an automation (both lists empty on 2026-09-24).
    ['hand-written automations list', automationsResponseSchema, automations],
    ['hand-written automation log', automationLogResponseSchema, automationLog],
    // S-19. The live one is this repo's merged PR #78 (0.11.1); the hand-written one is open, with a
    // failing and a pending check, as the host rarely holds one when a fixture is captured.
    ['live merge state, merged', githubPrMergeStateResponseSchema, liveMergeState],
    ['hand-written merge state, blocked', githubPrMergeStateResponseSchema, mergeState],
  ] as const)('%s matches the vendored schema', (_name, schema, fixture) => {
    const result = schema.safeParse(fixture)
    expect(result.error?.issues ?? []).toEqual([])
  })

  // The transcript recording is lines, not a response: each one must carry the envelope the
  // server writes (`runEventSchema` is open by design, so unknown types and fields pass).
  it('every line of the hand-written transcript recording is a valid run event', () => {
    const lines = recording.split('\n').filter((line) => line.trim() !== '')
    for (const line of lines) {
      const result = runEventSchema.safeParse(JSON.parse(line))
      expect(result.error?.issues ?? [], line).toEqual([])
    }
  })
})
