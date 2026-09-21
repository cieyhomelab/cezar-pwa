import { useCallback, useState } from 'react'

/**
 * Storage key. Holds a project id — never a secret (CLAUDE.md rule 6), and nothing that would
 * go stale in a dangerous way: an id that no longer exists simply reads as "all projects".
 */
export const PROJECT_FILTER_KEY = 'cezar-mobile:project-filter'

function read(): string | null {
  try {
    return localStorage.getItem(PROJECT_FILTER_KEY)
  } catch {
    // Storage can be unavailable (private mode, quota): the filter just stops surviving.
    return null
  }
}

function write(projectId: string | null): void {
  try {
    if (projectId === null) localStorage.removeItem(PROJECT_FILTER_KEY)
    else localStorage.setItem(PROJECT_FILTER_KEY, projectId)
  } catch {
    // See `read`.
  }
}

/**
 * FR-013: the list can be narrowed to one project, and the choice survives a restart.
 *
 * `known` is the set of project ids the instance reports. A remembered project that has since
 * been removed must not leave the operator staring at an empty list that claims to be the
 * whole truth, so it falls back to all projects — without forgetting the choice, in case the
 * registry is only momentarily unknown.
 */
export function useProjectFilter(known: readonly string[] | undefined) {
  const [stored, setStored] = useState<string | null>(read)

  const setProject = useCallback((projectId: string | null) => {
    write(projectId)
    setStored(projectId)
  }, [])

  const projectId = stored !== null && known?.includes(stored) ? stored : null
  return { projectId, setProject }
}
