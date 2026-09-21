import {
  processUsageSchema,
  runIndexEntrySchema,
  runRecordSchema,
  type RunsIndexResponse,
} from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { applyWorkspaceFrame } from '../../src/domain/live-index.ts'
import runsIndex from '../fixtures/runs-index.json'
import liveStream from '../fixtures/workspace-events.live-0.11.0.txt?raw'
import liveRunFrame from '../fixtures/workspace-run-frame.live-0.11.0.json'

/**
 * The workspace event stream against what the instance really sends (v0.11.0).
 *
 * - `workspace-events.live-0.11.0.txt` — the raw bytes of `GET /api/v1/workspace/events` over
 *   loopback, first frames only.
 * - `workspace-run-frame.live-0.11.0.json` — a `run` frame's `data`. None arrived during the
 *   capture (a run's record changes at turn and step boundaries), so it is the same record read
 *   from `GET /api/v1/p/cezar-pwa/runs/:id`, minus the `usage` that route attaches, stamped with
 *   `project` exactly as `server.js` stamps it. Prompt and worktree path are elided.
 *
 * The schemas are used here only; at runtime frames are read defensively (CLAUDE.md rule 5).
 */

/** The minimum of the SSE wire format the capture uses: `event:` + `data:` lines, blank-separated. */
function parseSse(text: string): { type: string; data: string }[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n')
      const type = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      return { type, data }
    })
}

describe('workspace event stream (live capture)', () => {
  const frames = parseSse(liveStream)

  it('carries the heartbeat and the per-project usage frames the client expects', () => {
    expect(frames.map((frame) => frame.type)).toContain('ping')
    const usageFrame = z.object({ project: z.string(), usage: z.record(z.string(), processUsageSchema) })
    for (const frame of frames.filter((f) => f.type === 'usage')) {
      expect(usageFrame.safeParse(JSON.parse(frame.data)).error?.issues ?? []).toEqual([])
    }
  })

  it('changes nothing in the list for frames that are not run changes', () => {
    const index = runsIndex as RunsIndexResponse
    for (const frame of frames) {
      const data = frame.data === '' ? null : JSON.parse(frame.data)
      expect(applyWorkspaceFrame(index, { type: frame.type, data })).toBe(index)
    }
  })
})

describe('run frame (live record)', () => {
  it('is a RunRecord stamped with project', () => {
    const { project, ...record } = liveRunFrame
    expect(project).toBe('cezar-pwa')
    expect(runRecordSchema.safeParse(record).error?.issues ?? []).toEqual([])
  })

  it('becomes a row the runs-index schema accepts', () => {
    const empty: RunsIndexResponse = { runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] }
    const result = applyWorkspaceFrame(empty, { type: 'run', data: liveRunFrame })
    expect(result.runs).toHaveLength(1)
    expect(runIndexEntrySchema.strict().safeParse(result.runs[0]).error?.issues ?? []).toEqual([])
    expect(result.runs[0].projectId).toBe('cezar-pwa')
  })
})
