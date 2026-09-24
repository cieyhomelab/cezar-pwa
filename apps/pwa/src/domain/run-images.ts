/**
 * Where a run's persisted image is read (#65). The server records attachment URLs in the
 * unscoped form `/api/v1/runs/:id/images/:file` — on a transcript `image` line and in a queued
 * message's `images` — and that form returns 404 on the live host. The project-scoped
 * `/api/v1/p/:projectId/runs/:id/images/:file` serves the bytes (CLAUDE.md rule 2).
 *
 * Only the file name is taken from a recorded URL, never its path, and only when it is a plain
 * name: anything that could step out of the `images/` directory is dropped.
 */

const FILE_NAME = /^[A-Za-z0-9._-]+$/

/** The file name a recorded attachment URL ends in, when it is a plain name under `images/`. */
export function attachmentFileName(recordedUrl: string): string | undefined {
  const path = recordedUrl.split(/[?#]/, 1)[0] ?? ''
  const match = /\/images\/([^/]+)$/.exec(path)
  const file = match?.[1]
  if (file === undefined || !FILE_NAME.test(file) || /^\.+$/.test(file)) return undefined
  return file
}

/** The project-scoped URL of one of a run's images, or `undefined` for a name that is not safe. */
export function runImageUrl(projectId: string, runId: string, file: string): string | undefined {
  if (!FILE_NAME.test(file) || /^\.+$/.test(file)) return undefined
  return `/api/v1/p/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/images/${file}`
}

/** A recorded attachment URL, rewritten onto the project-scoped route. */
export function scopedAttachmentUrl(projectId: string, runId: string, recordedUrl: string): string | undefined {
  const file = attachmentFileName(recordedUrl)
  return file === undefined ? undefined : runImageUrl(projectId, runId, file)
}
