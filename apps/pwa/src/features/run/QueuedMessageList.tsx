import type { QueuedMessage } from '@cezar-pwa/cezar-contract/contract'
import { useState } from 'react'
import { en } from '../../i18n/en.ts'
import type { QueuedMessages } from './useQueuedMessages.ts'

/**
 * The messages stacked onto a task's prompt (#66). While the task is queued each one can be
 * edited inline, under the composer's own rules (never empty, the draft kept on a failure), or
 * removed behind a confirmation. Once the task has started the stack is read-only.
 *
 * It sits inside the composer's form, so none of its buttons submits.
 */
export function QueuedMessageList({
  messages,
  editable,
  queue,
}: {
  messages: readonly QueuedMessage[]
  /** `false` once the task has started: nothing on the stack can change any more. */
  editable: boolean
  queue?: QueuedMessages
}) {
  return (
    <>
      {messages.length > 0 ? (
        <details className="text-sm text-text-muted">
          <summary className="touch-target flex cursor-pointer list-none items-center">
            {en.run.compose.queuedTitle(messages.length)}
          </summary>
          <ul className="flex flex-col gap-1 pb-1">
            {messages.map((message) => (
              <li key={message.id} className="rounded bg-surface-raised px-2 py-1 text-text">
                {editable && queue ? <EditableMessage message={message} queue={queue} /> : <MessageText text={message.text} />}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {queue?.notice ? (
        <p role="status" className="text-sm text-text-muted">
          {queue.notice}
        </p>
      ) : null}
    </>
  )
}

function MessageText({ text }: { text: string }) {
  return <p className="break-words whitespace-pre-wrap">{text}</p>
}

const quiet = 'touch-target rounded px-3 text-sm font-semibold text-accent disabled:opacity-60'
const strong = 'touch-target rounded px-3 text-sm font-semibold text-white disabled:opacity-60'

function EditableMessage({ message, queue }: { message: QueuedMessage; queue: QueuedMessages }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [draft, setDraft] = useState(message.text)
  const pending = queue.pending?.id === message.id ? queue.pending.kind : undefined
  const busy = queue.pending !== undefined
  const error = queue.error?.id === message.id ? queue.error.message : undefined
  const t = en.run.compose.queue

  const save = async () => {
    if (draft.trim() === '' || draft === message.text || busy) return
    if (await queue.edit(message.id, draft)) setMode('view')
  }
  const remove = async () => {
    if (busy) return
    if (!(await queue.remove(message.id))) setMode('view')
  }

  return (
    <div className="flex flex-col gap-1">
      {mode === 'edit' ? (
        <textarea
          aria-label={t.editLabel}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={Math.min(5, Math.max(1, draft.split('\n').length))}
          // 16 px or more: iOS zooms the page into any smaller field it focuses.
          className="min-h-11 w-full resize-none rounded border border-border bg-surface px-3 py-2.5 text-base"
          readOnly={pending === 'edit'}
        />
      ) : (
        <MessageText text={message.text} />
      )}
      <div className="flex flex-wrap items-center justify-end gap-1">
        {mode === 'edit' ? (
          <>
            <button type="button" className={quiet} disabled={pending === 'edit'} onClick={() => setMode('view')}>
              {t.cancel}
            </button>
            <button
              type="button"
              className={`${strong} bg-accent`}
              disabled={busy || draft.trim() === '' || draft === message.text}
              onClick={() => void save()}
            >
              {pending === 'edit' ? t.saving : t.save}
            </button>
          </>
        ) : mode === 'confirm' || pending === 'remove' ? (
          <>
            <p className="w-full text-text">{t.confirmRemove}</p>
            <button type="button" className={quiet} disabled={pending === 'remove'} onClick={() => setMode('view')}>
              {t.keep}
            </button>
            <button type="button" className={`${strong} bg-danger`} disabled={busy} onClick={() => void remove()}>
              {pending === 'remove' ? t.removing : t.remove}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={quiet}
              disabled={busy}
              onClick={() => {
                setDraft(message.text)
                setMode('edit')
              }}
            >
              {t.edit}
            </button>
            <button type="button" className={quiet} disabled={busy} onClick={() => setMode('confirm')}>
              {t.remove}
            </button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm break-words text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
