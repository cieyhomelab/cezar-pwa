import type { UiToolItem } from '@cezar-pwa/cezar-contract/protocol'
import type { TranscriptEntry, TranscriptTurn } from './transcript.ts'

/**
 * Display grouping over one turn's entries. It is the first two passes of the cockpit's
 * `thread-groups.ts` (tag `v0.11.0`) and nothing more:
 *
 *  1. Plan-kind tools leave the transcript, because the pinned plan owns them (#382).
 *  2. Sub-agent nesting: an entry whose `parentItemId` names a tool in the same turn moves
 *     under that tool, one level deep. An orphaned parent id renders at top level.
 *
 * Upstream's context groups and tool streaks are left out. On the phone every tool is already
 * one collapsed line (FR-017), and folding them further would hide how much work happened.
 */
export type TranscriptBlock =
  | { kind: 'entry'; id: string; entry: TranscriptEntry }
  | { kind: 'tool'; id: string; item: UiToolItem; children: TranscriptEntry[] }

function parentOf(entry: TranscriptEntry): string | undefined {
  return 'parentItemId' in entry && typeof entry.parentItemId === 'string' ? entry.parentItemId : undefined
}

export function turnBlocks(turn: TranscriptTurn): TranscriptBlock[] {
  const entries = turn.entries.filter((entry) => !(entry.kind === 'tool' && entry.toolKind === 'plan'))
  const toolIds = new Set(entries.filter((entry) => entry.kind === 'tool').map((entry) => entry.id))
  const children = new Map<string, TranscriptEntry[]>()
  for (const entry of entries) {
    const parent = parentOf(entry)
    if (parent === undefined || parent === entry.id || !toolIds.has(parent)) continue
    children.set(parent, [...(children.get(parent) ?? []), entry])
  }

  const blocks: TranscriptBlock[] = []
  for (const entry of entries) {
    const parent = parentOf(entry)
    if (parent !== undefined && parent !== entry.id && toolIds.has(parent)) continue
    blocks.push(
      entry.kind === 'tool'
        ? { kind: 'tool', id: entry.id, item: entry, children: children.get(entry.id) ?? [] }
        : { kind: 'entry', id: entry.id, entry },
    )
  }
  return blocks
}

/** A tool's raw input, shown when the line is expanded. A command reads as itself, not as JSON. */
export function toolInputText(input: unknown): string {
  if (input === undefined || input === null) return ''
  if (typeof input === 'string') return input
  if (typeof input === 'object' && !Array.isArray(input)) {
    const command = (input as Record<string, unknown>).command
    const keys = Object.keys(input)
    if (typeof command === 'string' && keys.every((key) => key === 'command' || key === 'description')) {
      return command
    }
  }
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

/** Longest tool output the phone renders. The rest stays in the cockpit. */
export const TOOL_OUTPUT_LIMIT = 4_000

/** Output clipped to the limit, keeping the END, which is where errors and results are. */
export function clipOutput(text: string, limit = TOOL_OUTPUT_LIMIT): { text: string; clipped: number } {
  if (text.length <= limit) return { text, clipped: 0 }
  return { text: text.slice(text.length - limit), clipped: text.length - limit }
}
