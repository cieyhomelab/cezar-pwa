/**
 * S-12 (FR-048): the same task in the full cockpit. The cockpit's routes at `v0.11.0`
 * (`packages/web/src/routes.tsx`) put a task at `/p/:projectId/tasks/:id` and its diff one level
 * under it, at `…/changes`. Both are real URLs the cockpit cold-loads, so a plain link works.
 *
 * Absolute from the origin, never under `/m/`: the cockpit is the gated site at `/`, not a screen
 * of this app, so these are `<a href>`, not router links. Ids are url-encoded, as in `runPath`.
 */

/** The task's thread in the cockpit. */
export function cockpitTaskPath(projectId: string, runId: string): string {
  return `/p/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(runId)}`
}

/** The task's Changes tab — where a diff the phone cut short is read in full. */
export function cockpitChangesPath(projectId: string, runId: string): string {
  return `${cockpitTaskPath(projectId, runId)}/changes`
}
