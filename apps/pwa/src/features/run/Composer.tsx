import type { QueuedMessage } from '@cezar-pwa/cezar-contract/contract'
import { type FormEvent, useState } from 'react'
import { en } from '../../i18n/en.ts'
import type { Delivery } from './useDeliver.ts'

/**
 * The free-text message (FR-023), docked under the transcript. Also the "write your own answer"
 * half of FR-022: any message resolves an open question, and when one is open its id rides
 * along so the card stops offering its options.
 *
 * The draft is cleared only once Cezar took it. A failure keeps every word, with the reason
 * next to the send button (FR-032).
 */
export function Composer({
  status,
  delivery,
  openAskId,
  queuedMessages = [],
}: {
  status: string
  delivery: Delivery
  openAskId?: string
  queuedMessages?: readonly QueuedMessage[]
}) {
  const [draft, setDraft] = useState('')
  const resuming = delivery.mode === 'resume'
  const placeholder = resuming
    ? en.run.compose.placeholder.resume
    : status === 'waiting'
      ? en.run.compose.placeholder.waiting
      : status === 'queued'
        ? en.run.compose.placeholder.queued
        : en.run.compose.placeholder.running
  const hint = resuming ? en.run.compose.hint.resume : status === 'queued' ? en.run.compose.hint.queued : undefined
  const error = delivery.error?.source === 'composer' ? delivery.error.message : undefined
  const empty = draft.trim() === ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (empty || delivery.pending) return
    if (await delivery.send(draft, 'composer', openAskId)) setDraft('')
  }

  return (
    <form
      aria-label={en.run.compose.label}
      onSubmit={(event) => void submit(event)}
      className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border bg-surface px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {queuedMessages.length > 0 ? (
        <details className="text-sm text-text-muted">
          <summary className="touch-target flex cursor-pointer list-none items-center">
            {en.run.compose.queuedTitle(queuedMessages.length)}
          </summary>
          <ul className="flex flex-col gap-1 pb-1">
            {queuedMessages.map((message) => (
              <li key={message.id} className="rounded bg-surface-raised px-2 py-1 break-words whitespace-pre-wrap text-text">
                {message.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
      <div className="flex items-end gap-2">
        <textarea
          aria-label={en.run.compose.label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          rows={Math.min(5, Math.max(1, draft.split('\n').length))}
          // 16 px or more: iOS zooms the page into any smaller field it focuses.
          className="min-h-11 flex-1 resize-none rounded border border-border bg-surface-raised px-3 py-2.5 text-base"
          readOnly={delivery.pending}
        />
        <button
          type="submit"
          className="touch-target shrink-0 rounded bg-accent px-4 font-semibold text-white disabled:opacity-60"
          disabled={empty || delivery.pending}
        >
          {delivery.pending ? en.run.compose.sending : en.run.compose.send}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm break-words text-danger">
          {error}
        </p>
      ) : delivery.notice ? (
        <p role="status" className="text-sm text-text-muted">
          {delivery.notice}
        </p>
      ) : null}
    </form>
  )
}
