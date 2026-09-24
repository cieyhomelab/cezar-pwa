import { useEffect, useRef } from 'react'
import { turnBlocks, type TranscriptBlock } from '../../domain/transcript-blocks.ts'
import type { Transcript, TranscriptEntry, TranscriptFooter } from '../../domain/transcript.ts'
import { en } from '../../i18n/en.ts'
import { AskCard } from './AskCard.tsx'
import { Markdown } from './Markdown.tsx'
import { RunImage } from './RunImage.tsx'
import { ToolLine } from './ToolLine.tsx'
import type { Delivery } from './useDeliver.ts'
import type { OlderHistory } from './useOlderHistory.ts'

/** The only question that can still be answered (`openAsk`), and the way to answer it. */
export type Answering = { delivery: Delivery; openAskId?: string }

/** Where a stored image file is read (`runImageUrl`, #65). Absent, images stay text lines. */
export type ImageSrc = (file: string) => string | undefined

function UserBubble({ label, text, imageCount = 0 }: { label: string; text: string; imageCount?: number }) {
  return (
    <div className="ml-8 rounded-lg bg-surface-raised px-3 py-2">
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      {/* A person's text, not markdown: their line breaks are meant, and nothing in it is
          interpreted. */}
      <p className="mt-1 break-words whitespace-pre-wrap">{text}</p>
      {imageCount > 0 ? (
        <p className="mt-1 text-xs text-text-muted">{en.run.transcript.imagesAttached(imageCount)}</p>
      ) : null}
    </div>
  )
}

function Entry({ entry, answering, imageSrc }: { entry: TranscriptEntry; answering?: Answering; imageSrc?: ImageSrc }) {
  switch (entry.kind) {
    case 'message':
      if (entry.role === 'user') return <UserBubble label={en.run.transcript.you} text={entry.text} />
      return entry.text.trim() === '' ? null : <Markdown text={entry.text} />
    case 'reasoning':
      return entry.text.trim() === '' ? null : (
        <details className="text-sm text-text-muted">
          <summary className="touch-target flex cursor-pointer list-none items-center">
            {en.run.transcript.reasoning}
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
    case 'image': {
      const src = entry.file !== undefined ? imageSrc?.(entry.file) : undefined
      return <RunImage {...(src !== undefined ? { src } : {})} {...(entry.name !== undefined ? { name: entry.name } : {})} />
    }
    case 'provider-auth-required':
      return <p className="text-sm text-danger">{en.run.transcript.providerAuth(entry.provider)}</p>
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

function Block({ block, answering, imageSrc }: { block: TranscriptBlock; answering?: Answering; imageSrc?: ImageSrc }) {
  return block.kind === 'tool' ? (
    <ToolLine item={block.item} nested={block.children} />
  ) : (
    <Entry
      entry={block.entry}
      {...(answering !== undefined ? { answering } : {})}
      {...(imageSrc !== undefined ? { imageSrc } : {})}
    />
  )
}

function Footer({ footer }: { footer: TranscriptFooter }) {
  if (footer === null) return null
  const text =
    footer.state === 'waiting'
      ? en.run.transcript.footer.waiting
      : footer.state === 'failed'
        ? footer.error
          ? en.run.transcript.footer.failedWith(footer.error)
          : en.run.transcript.footer.failed
        : footer.state === 'review'
          ? en.run.transcript.footer.review
          : en.run.transcript.footer.closed
  const tone =
    footer.state === 'failed' ? 'text-danger' : footer.state === 'waiting' ? 'text-pending' : 'text-text-muted'
  return <p className={`border-t border-border pt-3 text-sm break-words ${tone}`}>{text}</p>
}

/** How far above the screen the top of the transcript starts loading the page before it. */
export const OLDER_PRELOAD_PX = 300

/**
 * FR-049: the top of a transcript that does not reach the start. Scrolling near it asks for the
 * page before (an `IntersectionObserver` on the line itself); the button does the same by hand,
 * and is all there is where the observer is missing. A failed page offers a retry and the
 * cockpit, which can always show the whole transcript (FR-048); nothing retries on its own.
 */
function OlderEntries({ older, href }: { older: OlderHistory; href: string }) {
  const line = useRef<HTMLDivElement>(null)
  const { load, loading, error } = older
  const failed = error !== undefined

  useEffect(() => {
    const element = line.current
    if (element === null || loading || failed || typeof IntersectionObserver === 'undefined') return
    // Observing reports the current state at once, so a page that landed without pushing the
    // line off screen (a short page) asks for the next one straight away.
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) load()
      },
      { rootMargin: `${OLDER_PRELOAD_PX}px 0px 0px 0px` },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [load, loading, failed])

  if (failed) {
    return (
      <div role="alert" className="flex flex-col items-center gap-1 text-center text-sm">
        <p>{en.run.transcript.olderFailed}</p>
        <div className="flex items-center gap-3">
          <button type="button" className="touch-target rounded border border-border px-4" onClick={load}>
            {en.run.retry}
          </button>
          <a className="touch-target inline-flex items-center text-accent" href={href}>
            {en.run.transcript.olderInCockpit}
          </a>
        </div>
      </div>
    )
  }
  return (
    <div ref={line} className="flex justify-center">
      {loading ? (
        <p role="status" className="touch-target inline-flex items-center text-sm text-text-muted">
          {en.run.transcript.loadingOlder}
        </p>
      ) : (
        <button type="button" className="touch-target inline-flex items-center text-sm text-accent" onClick={load}>
          {en.run.transcript.showOlder}
        </button>
      )}
    </div>
  )
}

/**
 * The transcript, newest page first (FR-015), reaching further back as the operator scrolls up
 * (FR-049). At the start of the file the top says so, followed by the task prompt. Where no older
 * page can be asked for, the top points to the cockpit (FR-048).
 *
 * Every rendered entry carries `data-entry-key`: what `useKeepPlace` pins the reader to while
 * older entries land above.
 */
export function TranscriptView({
  transcript,
  task,
  hasOlder,
  older,
  olderHref,
  footer,
  answering,
  imageSrc,
}: {
  transcript: Transcript
  task: string
  hasOlder: boolean
  /** FR-049: the page before the one on screen. Absent, the top links to the cockpit. */
  older?: OlderHistory
  /** Where the older entries are read: this task in the cockpit (FR-048). */
  olderHref: string
  footer: TranscriptFooter
  /** S-07: how an open question is answered. Absent, every question is read-only. */
  answering?: Answering
  /** #65: where the transcript's images are read. */
  imageSrc?: ImageSrc
}) {
  const turns = transcript.turns
    .map((turn) => ({ turn, blocks: turnBlocks(turn) }))
    .filter(({ turn, blocks }) => blocks.length > 0 || turn.userMessage !== undefined)

  return (
    <section aria-label={en.run.transcript.heading} className="flex flex-col gap-3 px-4 py-4">
      {hasOlder ? (
        older?.available ? (
          <OlderEntries older={older} href={olderHref} />
        ) : (
          <p className="text-center text-xs text-text-muted">
            <a className="touch-target inline-flex items-center text-accent" href={olderHref}>
              {en.run.transcript.older}
            </a>
          </p>
        )
      ) : (
        <>
          <p className="text-center text-xs text-text-muted">{en.run.transcript.start}</p>
          {task.trim() !== '' ? <UserBubble label={en.run.transcript.task} text={task} /> : null}
        </>
      )}

      {turns.length === 0 ? <p className="text-sm text-text-muted">{en.run.transcript.empty}</p> : null}

      {turns.map(({ turn, blocks }) => (
        <article key={turn.id} className="flex flex-col gap-2">
          {turn.userMessage ? (
            <div data-entry-key={`${turn.id}:user`}>
              <UserBubble
                label={en.run.transcript.you}
                text={turn.userMessage.text}
                imageCount={turn.userMessage.imageCount}
              />
            </div>
          ) : null}
          {blocks.map((block) => (
            <div key={block.id} data-entry-key={block.id} className="empty:hidden">
              <Block
                block={block}
                {...(answering !== undefined ? { answering } : {})}
                {...(imageSrc !== undefined ? { imageSrc } : {})}
              />
            </div>
          ))}
        </article>
      ))}

      <Footer footer={footer} />
    </section>
  )
}
