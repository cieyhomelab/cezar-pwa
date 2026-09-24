import type { RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { HEALTH_QUERY_KEY, reprobeSession } from '../../api/health.ts'
import { bindLifecycle } from '../../api/live-stream.ts'
import { RUNS_INDEX_QUERY_KEY } from '../../api/runs-index.ts'
import { type LiveState, WorkspaceStream, workspaceJournal } from '../../api/workspace-events.ts'
import { applyWorkspaceFrame, type WorkspaceFrame } from '../../domain/live-index.ts'

export type LiveRuns = {
  state: LiveState
  /** When the current live connection opened; `null` while not live. The list is only current
   *  once a fetch has landed after this — the stream has no replay to fill the gap before it. */
  liveSince: number | null
  /**
   * When the list was last known to be current through the stream: the last frame received
   * before it stopped being live. `null` while live (then it is current now) or if it never was.
   * The screen takes the later of this and the last fetch as the list's age.
   */
  liveUntil: number | null
}

/**
 * S-04: keep `['runs-index']` current from the workspace event stream (FR-010) and say whether
 * that is happening (FR-012). Server state stays in TanStack Query — frames land through
 * `setQueryData`, never a store of their own (CLAUDE.md → "Code conventions").
 *
 * The stream is closed while the page is hidden and reopened when it is shown (`bindLifecycle`).
 */
export function useLiveRuns(): LiveRuns {
  const queryClient = useQueryClient()
  const [live, setLive] = useState<LiveRuns>({
    state: 'connecting',
    liveSince: null,
    liveUntil: null,
  })
  const lastFrameAt = useRef<number | null>(null)

  useEffect(() => {
    const onFrame = (frame: WorkspaceFrame) => {
      lastFrameAt.current = Date.now()
      workspaceJournal.record(frame)
      if (frame.type === 'project-added' || frame.type === 'project-removed') {
        // Names come from the health probe; a new project's runs from the index.
        void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
        void queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY })
        return
      }
      const current = queryClient.getQueryData<RunsIndexResponse>(RUNS_INDEX_QUERY_KEY)
      if (current === undefined) return
      const next = applyWorkspaceFrame(current, frame)
      // Only on a real change: a write would also move "updated at", which a ping must not.
      if (next !== current) queryClient.setQueryData(RUNS_INDEX_QUERY_KEY, next)
    }

    const stream = new WorkspaceStream({
      onFrame,
      // No replay on this stream, so every (re)open fills the gap with a fetch.
      onOpen: () => void queryClient.invalidateQueries({ queryKey: RUNS_INDEX_QUERY_KEY }),
      onDrop: () => reprobeSession(queryClient),
      onState: (state) => {
        // Taken now, not inside the updater: React runs that at render, which can be after the
        // gap-filling fetch has already landed — and a fetch older than `liveSince` never
        // counts as synced, so the list would say "live" and still show its age.
        const at = Date.now()
        setLive((previous) => ({
          state,
          liveSince: state === 'live' ? at : null,
          liveUntil:
            state === 'live' ? null : previous.state === 'live' ? lastFrameAt.current : previous.liveUntil,
        }))
      },
    })

    return bindLifecycle(stream)
  }, [queryClient])

  return live
}
