import { isUnread } from '@cezar-pwa/shared'
import type { ListSection } from './task-list.ts'

/**
 * "Mark all read" over the list on screen (#67). Pure, so which projects get a call is a table.
 *
 * Cezar's sweep is per project (`POST /api/v1/p/:projectId/runs/read-all`) and has no filter of
 * its own, so the phone narrows by choosing WHICH projects to call: only those with an unread
 * task among the rows the list shows — archived hidden, the project filter applied (FR-013).
 * A project with nothing unread in view is never called, so a filtered list never touches the
 * projects it hides.
 *
 * The sweep reaches the whole project, so it also stamps unread tasks the list does not paint:
 * older ones behind the index's per-project limit. Those are the same project's tasks, and the
 * unread rule is the same on both sides (`markAllRead()` in Cezar's `runs/store.js` is a
 * clause-for-clause copy of `isUnread`), so no task the list shows as read-worthy is skipped
 * and none it shows as needing the operator is touched.
 */
export type ReadAllPlan = {
  /** Project ids to call, in the order their first unread row appears in the list. */
  projects: string[]
  /** Unread rows on screen — the number the button offers to clear. */
  unread: number
}

export function readAllPlan(sections: readonly ListSection[]): ReadAllPlan {
  const projects: string[] = []
  let unread = 0
  for (const section of sections) {
    for (const { run } of section.rows) {
      if (!isUnread(run)) continue
      unread++
      if (!projects.includes(run.projectId)) projects.push(run.projectId)
    }
  }
  return { projects, unread }
}
