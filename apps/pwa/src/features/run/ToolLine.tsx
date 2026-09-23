import type { UiToolItem } from '@cezar-pwa/cezar-contract/protocol'
import { clipOutput, toolInputText } from '../../domain/transcript-blocks.ts'
import type { TranscriptEntry } from '../../domain/transcript.ts'
import { en } from '../../i18n/en.ts'

const STATUS_GLYPH: Record<string, string> = {
  pending: '…',
  running: '●',
  completed: '✓',
  failed: '✕',
  declined: '–',
}

const STATUS_TONE: Record<string, string> = {
  running: 'text-pending',
  completed: 'text-success',
  failed: 'text-danger',
}

function ToolStatus({ status }: { status: string }) {
  const word = en.run.transcript.tool.status[status] ?? status
  return (
    <span className={`inline-block w-4 shrink-0 text-center ${STATUS_TONE[status] ?? 'text-text-muted'}`}>
      <span aria-hidden="true">{STATUS_GLYPH[status] ?? '•'}</span>
      <span className="sr-only">{word}</span>
    </span>
  )
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      <pre className="mt-1 max-h-80 overflow-auto rounded bg-surface-raised p-2 text-xs leading-snug break-words whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  )
}

/** One sub-agent step, compact: the parent's expansion is already the detail view. */
function ChildLine({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === 'tool') {
    return (
      <li className="flex gap-2 py-0.5">
        <ToolStatus status={entry.status} />
        <span className="min-w-0 break-words">{entry.title || entry.name}</span>
      </li>
    )
  }
  if (entry.kind === 'message' || entry.kind === 'reasoning') {
    return <li className="py-0.5 break-words text-text-muted">{entry.text}</li>
  }
  return null
}

/**
 * A tool call collapsed to one line, expandable to its input and output (FR-017). Native
 * `<details>`: keyboard and screen-reader support come with it, and it needs no state.
 */
export function ToolLine({ item, nested }: { item: UiToolItem; nested: TranscriptEntry[] }) {
  const input = toolInputText(item.input)
  const output = typeof item.output === 'string' ? clipOutput(item.output) : null
  return (
    <details className="group rounded border border-border text-sm" data-tool-id={item.id}>
      <summary className="touch-target flex cursor-pointer list-none items-center gap-2 px-2">
        <ToolStatus status={item.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.title || item.name}</span>
        {typeof item.exitCode === 'number' && item.exitCode !== 0 ? (
          <span className="shrink-0 text-xs text-danger">{en.run.transcript.tool.exitCode(item.exitCode)}</span>
        ) : null}
        <span aria-hidden="true" className="shrink-0 text-text-muted group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-border px-2 pb-2">
        {input ? <Block label={en.run.transcript.tool.input} text={input} /> : null}
        {output && output.text ? (
          <Block
            label={en.run.transcript.tool.output}
            text={output.clipped > 0 ? `${en.run.transcript.tool.clipped(output.clipped)}\n${output.text}` : output.text}
          />
        ) : null}
        {item.error ? <Block label={en.run.transcript.tool.error} text={item.error} /> : null}
        {nested.length > 0 ? (
          <div className="mt-2">
            <p className="text-xs font-semibold text-text-muted">{en.run.transcript.tool.children(nested.length)}</p>
            <ul className="mt-1 text-xs">
              {nested.map((child) => (
                <ChildLine key={child.id} entry={child} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  )
}
