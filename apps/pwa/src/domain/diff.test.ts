import { describe, expect, it } from 'vitest'
import { type DiffLine, fileBody, limitLines, openByDefault, parsePatch, splitPath } from './diff.ts'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@ export function a() {',
  ' one',
  '-two',
  '+TWO',
  ' three',
  '@@ -10,2 +10,3 @@',
  ' ten',
  '+ten and a half',
  ' eleven',
  '\\ No newline at end of file',
  '',
].join('\n')

describe('parsePatch (upstream parse-patch.ts)', () => {
  it('reads hunks with per-side line numbers, skipping the file header', () => {
    const { hunks, truncated } = parsePatch(PATCH)
    expect(truncated).toBe(false)
    expect(hunks.map((hunk) => hunk.header)).toEqual(['@@ -1,3 +1,3 @@ export function a() {', '@@ -10,2 +10,3 @@'])
    expect(hunks[0]!.lines).toEqual<DiffLine[]>([
      { kind: 'context', text: 'one', oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'two', oldLine: 2 },
      { kind: 'add', text: 'TWO', newLine: 2 },
      { kind: 'context', text: 'three', oldLine: 3, newLine: 3 },
    ])
    // "\ No newline at end of file" is metadata, and the trailing newline is not a blank line.
    expect(hunks[1]!.lines).toEqual<DiffLine[]>([
      { kind: 'context', text: 'ten', oldLine: 10, newLine: 10 },
      { kind: 'add', text: 'ten and a half', newLine: 11 },
      { kind: 'context', text: 'eleven', oldLine: 11, newLine: 12 },
    ])
  })

  it.each<[string, string, DiffLine[]]>([
    // `@@ -0,0 +1 @@`: a new one-line file. A count of 1 may be omitted.
    ['new file', '@@ -0,0 +1 @@\n+only\n', [{ kind: 'add', text: 'only', newLine: 1 }]],
    [
      'deleted file',
      '@@ -1,2 +0,0 @@\n-a\n-b\n',
      [
        { kind: 'del', text: 'a', oldLine: 1 },
        { kind: 'del', text: 'b', oldLine: 2 },
      ],
    ],
    // A blank context line some tools emit as '' rather than ' '.
    [
      'bare blank context',
      '@@ -4,2 +4,2 @@\n a\n\nb',
      [
        { kind: 'context', text: 'a', oldLine: 4, newLine: 4 },
        { kind: 'context', text: '', oldLine: 5, newLine: 5 },
        { kind: 'context', text: '', oldLine: 6, newLine: 6 },
      ],
    ],
  ])('%s', (_name, patch, lines) => {
    expect(parsePatch(patch).hunks[0]!.lines).toEqual(lines)
  })

  it('stops at the server cap and says so, attributing nothing after it', () => {
    const { hunks, truncated } = parsePatch('@@ -1,3 +1,3 @@\n a\n-b\n… (patch truncated)')
    expect(truncated).toBe(true)
    expect(hunks[0]!.lines.map((line) => line.text)).toEqual(['a', 'b'])
  })

  it('an empty patch has no hunks', () => {
    expect(parsePatch('')).toEqual({ hunks: [], truncated: false })
  })
})

describe('fileBody', () => {
  it.each<[string, { binary: boolean; image?: boolean; patch: string }, string]>([
    ['binary', { binary: true, patch: '' }, 'binary'],
    // SVG: git does not flag it binary, the server flags it an image, and the phone loads no images.
    ['svg image', { binary: false, image: true, patch: '@@ -0,0 +1 @@\n+<svg/>\n' }, 'binary'],
    ['text', { binary: false, patch: PATCH }, 'text'],
    // A pure rename: `similarity index 100%` and no hunk.
    ['rename only', { binary: false, patch: 'diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n' }, 'no-content'],
    ['empty patch', { binary: false, patch: '' }, 'no-content'],
    // Cut before its first hunk: still a text file, and the cut is what gets said.
    ['cut before any hunk', { binary: false, patch: 'diff --git a/x b/x\n… (patch truncated)' }, 'text'],
  ])('%s', (_name, file, kind) => {
    expect(fileBody(file).kind).toBe(kind)
  })

  it('counts the lines of a text body', () => {
    const body = fileBody({ binary: false, patch: PATCH })
    expect(body.kind === 'text' ? body.lineCount : -1).toBe(7)
  })
})

describe('limitLines', () => {
  const patch = parsePatch(PATCH)

  it.each<[number, number[]]>([
    [100, [4, 3]],
    [7, [4, 3]],
    [5, [4, 1]],
    [4, [4]],
    [2, [2]],
    [0, []],
  ])('a page of %i lines', (limit, sizes) => {
    expect(limitLines(patch, limit).map((hunk) => hunk.lines.length)).toEqual(sizes)
  })
})

describe('splitPath', () => {
  it.each([
    ['apps/pwa/src/domain/diff.ts', { name: 'diff.ts', dir: 'apps/pwa/src/domain/' }],
    ['README.md', { name: 'README.md', dir: '' }],
  ])('%s', (path, expected) => {
    expect(splitPath(path)).toEqual(expected)
  })
})

describe('openByDefault', () => {
  it.each([
    [0, false],
    [1, true],
    [2, false],
  ])('%i files → %s', (count, open) => {
    expect(openByDefault(count)).toBe(open)
  })
})
