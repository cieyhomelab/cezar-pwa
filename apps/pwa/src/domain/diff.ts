import type { ChangedFile } from '@cezar-pwa/cezar-contract/contract'

/**
 * S-09: a task's diff, file by file, read-only (FR-031). The server already splits the diff per
 * file (`GET …/runs/:id/changes` → `ChangedFile.patch`, one `diff --git` section each), so what is
 * left for the phone is reading one section into rows.
 *
 * `parsePatch` is a port of the cockpit's (`packages/web/src/components/diff/parse-patch.ts`,
 * tag `v0.11.0`), without what the phone does not render: split rows, word-level marks and
 * expandable context need a wide screen and a second request. No syntax highlighting either: the
 * PRD names it a non-goal.
 */

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  /** The text without its `+`/`-`/space marker. */
  text: string
  /** 1-based, in the old file. Absent for adds. */
  oldLine?: number
  /** 1-based, in the new file. Absent for dels. */
  newLine?: number
}

export interface DiffHunk {
  /** The raw `@@ -a,b +c,d @@ …` line. */
  header: string
  lines: DiffLine[]
}

export interface ParsedPatch {
  hunks: DiffHunk[]
  /** The server capped this file's patch (`… (patch truncated)`, 200 000 chars at `v0.11.0`). */
  truncated: boolean
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const TRUNCATION_MARKER = '… (patch truncated)'

export function parsePatch(patch: string): ParsedPatch {
  const hunks: DiffHunk[] = []
  let truncated = false
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const raw = patch.split('\n')
  // git ends every section with a newline; the phantom '' after it is not a context line.
  if (raw.at(-1) === '') raw.pop()

  for (const line of raw) {
    const match = HUNK_RE.exec(line)
    if (match) {
      current = { header: line, lines: [] }
      oldLine = Number(match[1])
      newLine = Number(match[2])
      hunks.push(current)
      continue
    }
    if (line.includes(TRUNCATION_MARKER)) {
      truncated = true
      // The cap may have cut mid-hunk: nothing after it belongs to that hunk.
      current = null
      continue
    }
    // `diff --git`, `index`, `---`/`+++`, mode and rename lines: the file header shows those.
    if (!current) continue
    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', text: line.slice(1), newLine: newLine++ })
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', text: line.slice(1), oldLine: oldLine++ })
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file": metadata, not content on either side.
    } else {
      current.lines.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return { hunks, truncated }
}

/** What one file's body can show. Checked in this order: a binary has no text patch at all. */
export type FileBody =
  | { kind: 'binary'; image: boolean }
  | { kind: 'no-content' }
  | { kind: 'text'; patch: ParsedPatch; lineCount: number }

export function fileBody(file: Pick<ChangedFile, 'binary' | 'image' | 'patch'>): FileBody {
  // `image` is set for SVG too, which git does not flag binary. The phone does not load images
  // (S-05's rule), so an image is one line of text either way.
  if (file.binary || file.image === true) return { kind: 'binary', image: file.image === true }
  const patch = parsePatch(file.patch)
  const lineCount = patch.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
  // A pure rename or mode change has a header and no hunk. So does a patch the server could not
  // attribute to its file (`patchByPath` fell through) — the numbers still say what changed.
  if (lineCount === 0 && !patch.truncated) return { kind: 'no-content' }
  return { kind: 'text', patch, lineCount }
}

/**
 * The first `limit` lines of a patch, hunk by hunk. A long file renders a page at a time: every
 * line is a DOM row, and a 200 000-character patch is thousands of them on a phone.
 */
export function limitLines(patch: ParsedPatch, limit: number): DiffHunk[] {
  const out: DiffHunk[] = []
  let left = limit
  for (const hunk of patch.hunks) {
    if (left <= 0) break
    out.push(hunk.lines.length <= left ? hunk : { ...hunk, lines: hunk.lines.slice(0, left) })
    left -= hunk.lines.length
  }
  return out
}

/** Lines shown per page of one file. */
export const DIFF_LINE_PAGE = 1000

/** The file's path as a phone can read it: the name first, the directory after. */
export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash + 1) }
}

/** Whether a file opens on arrival. One file: it is the whole diff. More: the list is the index. */
export function openByDefault(fileCount: number): boolean {
  return fileCount === 1
}
