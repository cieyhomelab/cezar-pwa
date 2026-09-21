import type { ApiRun } from '@cezar-pwa/cezar-contract/contract'
import { isUnread } from '@cezar-pwa/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { applyReadReceipt, markRunRead } from '../../api/run.ts'

/**
 * Opening a task marks it read (FR-020), like the cockpit's thread. The receipt goes only for a
 * run that is genuinely unread, so it converges: the written `seenAt` makes `isUnread` false and
 * nothing fires again. A run that resumes and finishes again (a new `finishedAt`) is unread
 * again, and is marked again while it stays open.
 *
 * A failed receipt is not surfaced. It is a side effect of reading, the row keeps its unread
 * marker, which is the truth, and the next opening tries again.
 */
export function useMarkRead(projectId: string, runId: string, run: ApiRun | undefined): void {
  const queryClient = useQueryClient()
  const { mutate } = useMutation({
    mutationFn: () => markRunRead(projectId, runId),
    onSuccess: (answer) => applyReadReceipt(queryClient, projectId, runId, answer),
  })
  const sentFor = useRef<string | undefined>(undefined)
  const unread = run !== undefined && run.id === runId && isUnread(run)
  const receiptKey = `${projectId}\0${runId}\0${run?.finishedAt ?? ''}`

  useEffect(() => {
    if (!unread || sentFor.current === receiptKey) return
    sentFor.current = receiptKey
    mutate()
  }, [unread, receiptKey, mutate])
}
