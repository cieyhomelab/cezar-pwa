#!/usr/bin/env node
// Records the long-transcript fixtures for FR-049 (#64): a synthetic run long enough for several
// history pages, and those pages as Cezar's own reader cuts them.
//
//   node scripts/record-history-pages.mjs <path to cezar's dist/runs/event-history.js>
//
// On the VPS: /usr/lib/node_modules/cezar-cli/node_modules/@open-mercato/cezar/dist/runs/event-history.js
// Writes apps/pwa/test/fixtures/transcript-long.ndjson and history-pages.long.json. The
// transcript is deterministic; the pages are whatever the given server version returns for it.
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const reader = process.argv[2]
if (!reader) {
  console.error('usage: record-history-pages.mjs <cezar dist/runs/event-history.js>')
  process.exit(1)
}
const fixtures = new URL('../apps/pwa/test/fixtures/', import.meta.url)
const ndjson = new URL('transcript-long.ndjson', fixtures)

const lines = []
let seq = 0
let clock = Date.parse('2026-09-22T09:00:00.000Z')
const push = (event) => {
  seq += 1
  clock += 1500
  lines.push(JSON.stringify({ seq, ts: new Date(clock).toISOString(), ...event }))
}
const S = { stepId: 'task' }
push({ type: 'lifecycle', message: 'run started — workflow "quick-task" (runner: claude)' })
push({ type: 'step-start', ...S, name: 'Do the task', kind: 'agent', iteration: 1 })
push({ type: 'session.started', ...S, sessionId: 's-long', backend: 'claude', model: 'claude-opus-5' })
const files = ['src/api/run.ts', 'src/domain/transcript.ts', 'src/features/run/RunScreen.tsx', 'docs/CEZAR_API.md', 'package.json']
let tool = 0
let msg = 0
function toolItem(i) {
  tool += 1
  const id = `toolu_${tool}`
  const read = i % 3 !== 0
  const name = read ? 'Read' : 'Bash'
  const file = files[tool % files.length]
  const input = read ? { file_path: file } : { command: `npm test -- step ${tool}` }
  const title = read ? `Read ${file}` : `Ran npm test -- step ${tool}`
  const toolKind = read ? 'read' : 'execute'
  push({ type: 'item.started', ...S, item: { kind: 'tool', id, name, toolKind, title, status: 'running', input } })
  push({ type: 'tool-call', ...S, id, tool: name, input })
  const output = read ? `// ${file}, line ${tool}` : `ok ${tool}\n`
  push({ type: 'item.completed', ...S, item: { kind: 'tool', id, name, toolKind, title, status: 'completed', input, output } })
  push({ type: 'tool-result', ...S, toolCallId: id, result: output })
}
function message(text) {
  msg += 1
  const id = `item_${msg}`
  push({ type: 'item.started', ...S, item: { kind: 'message', id, role: 'assistant', text: '' } })
  push({ type: 'item.completed', ...S, item: { kind: 'message', id, role: 'assistant', text } })
  push({ type: 'text', ...S, text })
}
// Turn 1: one long turn, longer than a page on its own.
push({ type: 'turn.started', ...S, turnId: 'turn_1' })
push({ type: 'plan.updated', ...S, entries: [{ content: 'Read the code', status: 'in_progress', activeForm: 'Reading the code' }, { content: 'Fix it', status: 'pending' }] })
for (let i = 0; i < 110; i += 1) {
  toolItem(i)
  if (i % 40 === 39) message(`Checkpoint ${i + 1}: still reading, nothing broken so far.`)
}
message('First pass done. **Everything reads cleanly.**')
push({ type: 'turn.completed', ...S, turnId: 'turn_1', stopReason: 'end_turn', costUsd: 0.4 })
push({ type: 'ask.requested', ...S, requestId: 'ask-1', questions: [{ header: 'Scope', question: 'Fix the tests too?', options: [{ label: 'yes' }, { label: 'no' }] }] })
for (let turn = 2; turn <= 30; turn += 1) {
  push({ type: 'user-message', ...S, text: turn === 2 ? 'Scope: yes' : `Follow-up ${turn}: keep going.`, imageCount: 0 })
  push({ type: 'turn.started', ...S, turnId: `turn_${turn}` })
  if (turn % 7 === 0) push({ type: 'note', ...S, text: `Retrying after a rate limit (turn ${turn}).`, tone: 'dim' })
  for (let i = 0; i < 4; i += 1) toolItem(i)
  message(`Turn ${turn} done: ${turn * 3} checks green.`)
  push({ type: 'turn.completed', ...S, turnId: `turn_${turn}`, stopReason: 'end_turn', costUsd: 0.02 })
}
push({ type: 'session.ended', ...S, reason: 'end_turn' })
writeFileSync(ndjson, `${lines.join('\n')}\n`)

// Newest page first, then each `olderCursor` in turn, exactly as the phone walks back.
const { readRunHistoryPage } = await import(pathToFileURL(reader).href)
const pages = []
let cursor
do {
  const page = await readRunHistoryPage(ndjson.pathname, cursor)
  pages.push({ cursor: cursor ?? null, page })
  cursor = page.hasOlder ? page.olderCursor : undefined
} while (cursor)
writeFileSync(new URL('history-pages.long.json', fixtures), `${JSON.stringify(pages)}\n`)
console.log(`${lines.length} lines, ${pages.length} pages`)
