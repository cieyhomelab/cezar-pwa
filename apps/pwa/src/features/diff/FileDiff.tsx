import type { ChangedFile } from '@cezar-pwa/cezar-contract/contract'
import { useId, useMemo, useState } from 'react'
import { DIFF_LINE_PAGE, type DiffLine, fileBody, limitLines, splitPath } from '../../domain/diff.ts'
import { en } from '../../i18n/en.ts'
import { DiffCounts } from './DiffCounts.tsx'

const LINE_CLASS: Record<DiffLine['kind'], string> = {
  add: 'bg-diff-add',
  del: 'bg-diff-del',
  context: '',
}

const MARKER: Record<DiffLine['kind'], string> = { add: '+', del: '−', context: '' }

function Line({ line }: { line: DiffLine }) {
  const kind = en.run.diff.lineKind[line.kind] ?? ''
  return (
    <div className={`flex ${LINE_CLASS[line.kind]}`}>
      <span aria-hidden="true" className="w-9 shrink-0 pr-1 text-right text-text-muted select-none">
        {line.kind === 'del' ? line.oldLine : line.newLine}
      </span>
      <span aria-hidden="true" className="w-4 shrink-0 text-center select-none">
        {MARKER[line.kind]}
      </span>
      {kind ? <span className="sr-only">{kind}: </span> : null}
      {/* Wrapped, never scrolled sideways: a phone has no room for a second scroller. */}
      <span className="min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
        {line.text === '' ? ' ' : line.text}
      </span>
    </div>
  )
}

function Body({ file, cockpitHref }: { file: ChangedFile; cockpitHref: string }) {
  const [limit, setLimit] = useState(DIFF_LINE_PAGE)
  const body = useMemo(() => fileBody(file), [file])

  if (body.kind === 'binary') {
    return <p className="px-4 py-3 text-sm text-text-muted">{body.image ? en.run.diff.image : en.run.diff.binary}</p>
  }
  if (body.kind === 'no-content') {
    return <p className="px-4 py-3 text-sm text-text-muted">{en.run.diff.noContent}</p>
  }

  const hunks = limitLines(body.patch, limit)
  const left = body.lineCount - limit
  return (
    <div className="font-mono text-xs leading-5">
      {hunks.map((hunk, index) => (
        <div key={index}>
          <div className="bg-surface-raised px-2 py-1 break-words whitespace-pre-wrap text-text-muted [overflow-wrap:anywhere]">
            {hunk.header}
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <Line key={lineIndex} line={line} />
          ))}
        </div>
      ))}
      {left > 0 ? (
        <div className="px-4 py-2 font-sans">
          <button
            type="button"
            className="touch-target rounded border border-border px-4 text-sm"
            onClick={() => setLimit((current) => current + DIFF_LINE_PAGE)}
          >
            {en.run.diff.showMore(Math.min(left, DIFF_LINE_PAGE))}
          </button>
        </div>
      ) : null}
      {body.patch.truncated && left <= 0 ? (
        <p role="note" className="px-4 py-3 font-sans text-sm text-text-muted">
          {en.run.diff.truncated}{' '}
          <a className="touch-target inline-flex items-center text-accent underline" href={cockpitHref}>
            {en.run.diff.openCockpit}
          </a>
        </p>
      ) : null}
    </div>
  )
}

/**
 * One changed file (FR-031): a header that says which file, how, and by how much, and under it,
 * once opened, its patch. The patch is parsed only while open, so a long diff costs only the
 * files the operator reads.
 */
export function FileDiff({
  file,
  defaultOpen,
  cockpitHref,
}: {
  file: ChangedFile
  defaultOpen: boolean
  /** Where a patch the server cut short is read in full: the cockpit's Changes tab (FR-048). */
  cockpitHref: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const { name, dir } = splitPath(file.path)
  const status = en.run.diff.status[file.status] ?? en.run.diff.statusUnknown

  return (
    <section aria-label={file.path} className="border-b border-border">
      {/* Sticky under the back bar, so a long patch still says whose it is. */}
      <h3 className="sticky top-11 z-10 bg-surface">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
          className="touch-target flex w-full items-start gap-2 px-4 py-2 text-left"
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-text-muted">
            {open ? '▾' : '▸'}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-mono text-sm break-all">{name}</span>
            {dir ? <span className="font-mono text-xs break-all text-text-muted">{dir}</span> : null}
            <span className="text-xs text-text-muted">
              {status}
              {file.oldPath ? <span className="break-all"> · {en.run.diff.renamedFrom(file.oldPath)}</span> : null}
            </span>
          </span>
          <DiffCounts adds={file.adds} dels={file.dels} />
        </button>
      </h3>
      {open ? (
        <div id={bodyId}>
          <Body file={file} cockpitHref={cockpitHref} />
        </div>
      ) : null}
    </section>
  )
}
