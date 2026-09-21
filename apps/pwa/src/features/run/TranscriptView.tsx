import { turnBlocks, type TranscriptBlock } from '../../domain/transcript-blocks.ts'
import type { Transcript, TranscriptEntry, TranscriptFooter } from '../../domain/transcript.ts'
import { pl } from '../../i18n/pl.ts'
import { AskCard } from './AskCard.tsx'
import { Markdown } from './Markdown.tsx'
import { ToolLine } from './ToolLine.tsx'
import type { Delivery } from './useDeliver.ts'

/** The only question that can still be answered (`openAsk`), and the way to answer it. */
export type Answering = { delivery: Delivery; openAskId?: string }

function UserBubble({ label, text, imageCount = 0 }: { label: string; text: string; imageCount?: number }) {
  return (
    <div className="ml-8 rounded-lg bg-surface-raised px-3 py-2">
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      {/* A person's text, not markdown: their line breaks are meant, and nothing in it is
          interpreted. */}
      <p className="mt-1 break-words whitespace-pre-wrap">{text}</p>
      {imageCount > 0 ? (
        <p className="mt-1 text-xs text-text-muted">{pl.run.transcript.imagesAttached(imageCount)}</p>
      ) : null}
    </div>
  )
}

function Entry({ entry, answering }: { entry: TranscriptEntry; answering?: Answering }) {
  switch (entry.kind) {
    case 'message':
      if (entry.role === 'user') return <UserBubble label={pl.run.transcript.you} text={entry.text} />
      return entry.text.trim() === '' ? null : <Markdown text={entry.text} />
    case 'reasoning':
      return entry.text.trim() === '' ? null : (
        <details className="text-sm text-text-muted">
          <summary className="touch-target flex cursor-pointer list-none items-center">
            {pl.run.transcript.reasoning}
          </summary>
          <p className="break-words whitespace-pre-wrap">{entry.text}</p>
        </details>
      )
    case 'note':
      return (
        <p className={`text-sm break-words ${entry.tone === 'danger' ? 'text-danger' : 'text-text-muted'}`}>
          {entry.text}
        </p>
      )
    case 'image':
      return <p className="text-sm text-text-muted">{pl.run.transcript.image(entry.name)}</p>
    case 'provider-auth-required':
      return <p className="text-sm text-danger">{pl.run.transcript.providerAuth(entry.provider)}</p>
    case 'ask':
      return (
        <AskCard
          ask={entry}
          {...(answering !== undefined ? { delivery: answering.delivery } : {})}
          superseded={answering !== undefined && !entry.resolved && entry.id !== answering.openAskId}
        />
      )
    case 'tool':
      return <ToolLine item={entry} nested={[]} />
    default:
      // An entry kind a later port adds before this renderer learns it (rule 5).
      return null
  }
}

function Block({ block, answering }: { block: TranscriptBlock; answering?: Answering }) {
  return block.kind === 'tool' ? (
    <ToolLine item={block.item} nested={block.children} />
  ) : (
    <Entry entry={block.entry} {...(answering !== undefined ? { answering } : {})} />
  )
}

function Footer({ footer }: { footer: TranscriptFooter }) {
  if (footer === null) return null
  const text =
    footer.state === 'waiting'
      ? pl.run.transcript.footer.waiting
      : footer.state === 'failed'
        ? footer.error
          ? pl.run.transcript.footer.failedWith(footer.error)
          : pl.run.transcript.footer.failed
        : footer.state === 'review'
          ? pl.run.transcript.footer.review
          : pl.run.transcript.footer.closed
  const tone =
    footer.state === 'failed' ? 'text-danger' : footer.state === 'waiting' ? 'text-pending' : 'text-text-muted'
  return <p className={`border-t border-border pt-3 text-sm break-words ${tone}`}>{text}</p>
}

/**
 * The newest stretch of the transcript (FR-015). The task prompt shows at the top only when the
 * page reaches back to the start. Otherwise the top says older entries live in the cockpit
 * (FR-049 is parked).
 */
export function TranscriptView({
  transcript,
  task,
  hasOlder,
  footer,
  answering,
}: {
  transcript: Transcript
  task: string
  hasOlder: boolean
  footer: TranscriptFooter
  /** S-07: how an open question is answered. Absent, every question is read-only. */
  answering?: Answering
}) {
  const turns = transcript.turns
    .map((turn) => ({ turn, blocks: turnBlocks(turn) }))
    .filter(({ turn, blocks }) => blocks.length > 0 || turn.userMessage !== undefined)

  return (
    <section aria-label={pl.run.transcript.heading} className="flex flex-col gap-3 px-4 py-4">
      {hasOlder ? (
        <p className="text-center text-xs text-text-muted">
          <a className="touch-target inline-flex items-center text-accent" href="/">
            {pl.run.transcript.older}
          </a>
        </p>
      ) : task.trim() !== '' ? (
        <UserBubble label={pl.run.transcript.task} text={task} />
      ) : null}

      {turns.length === 0 ? <p className="text-sm text-text-muted">{pl.run.transcript.empty}</p> : null}

      {turns.map(({ turn, blocks }) => (
        <article key={turn.id} className="flex flex-col gap-2">
          {turn.userMessage ? (
            <UserBubble
              label={pl.run.transcript.you}
              text={turn.userMessage.text}
              imageCount={turn.userMessage.imageCount}
            />
          ) : null}
          {blocks.map((block) => (
            <Block key={block.id} block={block} {...(answering !== undefined ? { answering } : {})} />
          ))}
        </article>
      ))}

      <Footer footer={footer} />
    </section>
  )
}
