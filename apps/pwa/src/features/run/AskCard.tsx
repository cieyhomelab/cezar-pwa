import type { UiAskQuestion } from '@cezar-pwa/cezar-contract/protocol'
import { useState } from 'react'
import { combineAnswers, formatAnswer, isOneTap, toggleSelection } from '../../domain/answer.ts'
import type { TranscriptAsk } from '../../domain/transcript.ts'
import { pl } from '../../i18n/pl.ts'
import type { Delivery } from './useDeliver.ts'

/**
 * The agent's question (FR-022), after the cockpit's `ask-card.tsx`. A single single-select
 * question answers on one tap. Any other shape collects every answer and sends them as one
 * message, because the transcript resolves the whole card on the next message. The operator's
 * own answer goes through the composer below, which reaches the agent the same way.
 *
 * `delivery` is absent where the screen offers no answering at all (a test, or a superseded
 * question). A task with nothing to reopen shows the card inert, with the reason.
 */
export function AskCard({ ask, delivery, superseded }: { ask: TranscriptAsk; delivery?: Delivery; superseded: boolean }) {
  if (ask.resolved) {
    return (
      <section data-ask-id={ask.id} data-resolved="true" className="rounded border border-border px-3 py-2 text-sm">
        <p className="font-semibold text-text-muted">{pl.run.transcript.ask.title}</p>
        {ask.questions.map((question, index) => (
          <p key={question.id ?? index} className="mt-1 break-words">
            {question.question}
          </p>
        ))}
        {ask.answer ? (
          <p className="mt-1 break-words whitespace-pre-line text-text-muted">
            {pl.run.transcript.ask.answered(ask.answer)}
          </p>
        ) : null}
      </section>
    )
  }
  return <OpenAsk ask={ask} delivery={superseded ? undefined : delivery} superseded={superseded} />
}

function OpenAsk({ ask, delivery, superseded }: { ask: TranscriptAsk; delivery?: Delivery; superseded: boolean }) {
  const [selections, setSelections] = useState<Record<number, string[]>>({})
  const questions = ask.questions
  const oneTap = isOneTap(questions)
  const answered = delivery?.answeredAskId === ask.id
  const unavailable = delivery?.mode === 'unavailable'
  const disabled = delivery === undefined || unavailable || delivery.pending || answered
  const resuming = delivery?.mode === 'resume'
  const allAnswered = questions.every((_, index) => (selections[index]?.length ?? 0) > 0)
  const error = delivery?.error?.source === 'ask' ? delivery.error.message : undefined

  const pick = (index: number, question: UiAskQuestion, label: string) => {
    if (disabled || delivery === undefined) return
    if (oneTap) {
      setSelections({ [index]: [label] })
      void delivery.send(formatAnswer(question, [label]), 'ask', ask.id)
      return
    }
    setSelections((prev) => ({
      ...prev,
      [index]: toggleSelection(prev[index] ?? [], label, question.multiSelect === true),
    }))
  }

  return (
    <section
      data-ask-id={ask.id}
      data-resolved="false"
      aria-busy={delivery?.pending === true}
      className="rounded border border-pending px-3 py-3"
    >
      <p className="text-sm font-semibold text-pending">{pl.run.transcript.ask.title}</p>

      <div className="mt-2 flex flex-col gap-4">
        {questions.map((question, index) => (
          <div key={question.id ?? index} role="group" aria-label={question.question}>
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <span className="rounded bg-surface-raised px-1.5 py-0.5 font-semibold uppercase">{question.header}</span>
              {question.multiSelect === true ? <span>{pl.run.transcript.ask.multiSelect}</span> : null}
            </p>
            <p className="mt-1 font-medium break-words">{question.question}</p>
            <div className="mt-2 flex flex-col gap-2">
              {question.options.map((option) => {
                const selected = (selections[index] ?? []).includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => pick(index, question, option.label)}
                    className={`touch-target flex w-full flex-col items-start justify-center gap-0.5 rounded border px-3 py-2 text-left disabled:opacity-60 ${
                      selected ? 'border-accent bg-surface-raised' : 'border-border'
                    }`}
                  >
                    <span className="flex items-start gap-2 font-medium break-words">
                      {question.multiSelect === true ? (
                        <span aria-hidden="true" className="w-4 shrink-0">
                          {selected ? '☑' : '☐'}
                        </span>
                      ) : null}
                      <span className="min-w-0 break-words">{option.label}</span>
                    </span>
                    {option.description ? (
                      <span className="text-sm break-words text-text-muted">{option.description}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {superseded ? (
        <p className="mt-3 text-xs text-text-muted">{pl.run.transcript.ask.superseded}</p>
      ) : delivery === undefined ? (
        <p className="mt-3 text-xs text-text-muted">{pl.run.transcript.ask.pending}</p>
      ) : unavailable ? (
        <p className="mt-3 text-xs text-text-muted">{pl.run.compose.failed.unavailable}</p>
      ) : answered ? (
        <p role="status" className="mt-3 text-sm text-text-muted">
          {pl.run.transcript.ask.sent}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {oneTap ? null : (
            <button
              type="button"
              className="touch-target rounded bg-accent px-4 font-semibold text-white disabled:opacity-60"
              disabled={disabled || !allAnswered}
              onClick={() => void delivery.send(combineAnswers(questions, selections), 'ask', ask.id)}
            >
              {delivery.pending
                ? pl.run.compose.sending
                : resuming
                  ? pl.run.transcript.ask.sendAndReopen
                  : pl.run.transcript.ask.send}
            </button>
          )}
          {oneTap && delivery.pending ? (
            <p role="status" className="text-sm text-text-muted">
              {pl.run.compose.sending}
            </p>
          ) : null}
          <p className="text-xs text-text-muted">
            {resuming
              ? pl.run.transcript.ask.resumeHint
              : oneTap
                ? pl.run.transcript.ask.pickOrWrite
                : pl.run.transcript.ask.answerEach}
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm break-words text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
