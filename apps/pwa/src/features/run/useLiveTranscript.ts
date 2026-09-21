import type { ApiRun, RunHistoryPage, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { reprobeSession } from '../../api/health.ts'
import { bindLifecycle, type LiveState, LiveStream, type StreamFrame } from '../../api/live-stream.ts'
import { RUN_FRAME_TYPES, runEventsUrl } from '../../api/run-events.ts'
import { historyQueryKey, runQueryKey } from '../../api/run.ts'
import { RUNS_INDEX_QUERY_KEY } from '../../api/runs-index.ts'
import { applyWorkspaceFrame } from '../../domain/live-index.ts'
import { appendLiveEvent, asRunEvent } from '../../domain/live-transcript.ts'

export type LiveTranscript = {
  state: LiveState
  /** The last time the screen was known current through the stream: now while live, else the
   *  last frame before it stopped being live. `null` if it never was. */
  liveUntil: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * S-06: keep one task's transcript and header current from its event stream (FR-016), and resume
 * it after the phone froze the app with nothing lost and nothing duplicated (FR-021).
 *
 * Server state stays in TanStack Query: stream lines land in `['history', …]` through
 * `appendLiveEvent`, `run` frames in `['run', …]` and in the list's row. Every connect asks for
 * `afterSeq` = the page's high-water mark, so the server replays exactly the gap. The stream is
 * closed while the page is hidden and reopened when it is shown (`bindLifecycle`), which is the
 * resume after a suspension.
 *
 * Starts once the first page is in: the page's `liveCursor` and `asOfSeq` are the resume point.
 */
export function useLiveTranscript(projectId: string, runId: string, ready: boolean): LiveTranscript {
  const queryClient = useQueryClient()
  const [live, setLive] = useState<LiveTranscript>({ state: 'connecting', liveUntil: null })
  const lastFrameAt = useRef<number | null>(null)

  useEffect(() => {
    if (!ready) return
    const pageKey = historyQueryKey(projectId, runId)
    /** The high-water mark this connection started from: deltas for items not snapshotted since
     *  may have lost their middle while nobody listened (`appendLiveEvent`). */
    let boundary = 0
    /** A cursor the server rejects (409 when the file shrank) would fail every attempt, and
     *  EventSource cannot say why. After an attempt that never opened, connect without it: the
     *  server then reads the whole file, which is slower but always valid. */
    let opened = true

    const url = () => {
      const page = queryClient.getQueryData<RunHistoryPage>(pageKey)
      boundary = page?.asOfSeq ?? 0
      const cursor = opened ? page?.liveCursor : undefined
      opened = false
      return runEventsUrl(projectId, runId, { cursor, afterSeq: boundary })
    }

    const onFrame = ({ type, data }: StreamFrame) => {
      lastFrameAt.current = Date.now()
      if (type === 'ui-event' || type === 'run-event') {
        const event = asRunEvent(data)
        if (event === undefined) return
        const page = queryClient.getQueryData<RunHistoryPage>(pageKey)
        if (page === undefined) return
        const next = appendLiveEvent(page, event, boundary)
        if (next !== page) queryClient.setQueryData(pageKey, next)
        return
      }
      if (type === 'run') {
        if (!isRecord(data) || data.id !== runId || typeof data.status !== 'string') return
        // The frame is the bare record; the fetched one also carries API-only fields (the live
        // `usage` sample), which it keeps.
        queryClient.setQueryData<ApiRun>(runQueryKey(projectId, runId), (run) =>
          run ? { ...run, ...(data as Partial<ApiRun>) } : run,
        )
        queryClient.setQueryData<RunsIndexResponse>(RUNS_INDEX_QUERY_KEY, (index) =>
          index ? applyWorkspaceFrame(index, { type: 'run', data: { ...data, project: projectId } }) : index,
        )
      }
      // `ping`: liveness only, which the stream's watchdog already counted.
    }

    const stream = new LiveStream({
      url,
      frameTypes: RUN_FRAME_TYPES,
      onFrame,
      onOpen: () => {
        opened = true
      },
      onDrop: () => reprobeSession(queryClient),
      onState: (state) => {
        const at = Date.now()
        setLive((previous) => ({
          state,
          liveUntil:
            state === 'live' ? at : previous.state === 'live' ? (lastFrameAt.current ?? at) : previous.liveUntil,
        }))
      },
    })
    return bindLifecycle(stream)
  }, [projectId, runId, ready, queryClient])

  return live
}
