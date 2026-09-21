/**
 * One task's event stream (`docs/CEZAR_API.md` § 3b), the transport of S-06.
 *
 * `GET /api/v1/p/:projectId/runs/:id/events?cursor=<liveCursor>&afterSeq=<n>` replays every
 * persisted line after `max(afterSeq, the cursor's boundary)` and then goes live. The cursor is
 * the history page's `liveCursor`: a byte offset into the run's file, so the server reads only
 * the tail instead of the whole transcript. The cockpit connects the same way.
 */

/**
 * - `ui-event` — a protocol-v2 line (dotted type), persisted or an ephemeral `item.delta`
 * - `run-event` — a v1 line; the history page carries both kinds, so the stream does too
 * - `run` — the whole record after every change, and once after the replay
 * - `ping` — every 15 s
 */
export const RUN_FRAME_TYPES = ['ui-event', 'run-event', 'run', 'ping'] as const

export function runEventsUrl(
  projectId: string,
  runId: string,
  resume: { cursor?: string; afterSeq: number },
): string {
  const params = new URLSearchParams()
  if (resume.cursor) params.set('cursor', resume.cursor)
  params.set('afterSeq', String(resume.afterSeq))
  return `/api/v1/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/events?${params}`
}
