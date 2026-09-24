import type { RunEvent } from '@cezar-pwa/cezar-contract/contract'
import type {
  PlanEntry,
  PlanStatus,
  StopReason,
  ToolKind,
  UiAskQuestion,
  UiItem,
  UiToolItem,
} from '@cezar-pwa/cezar-contract/protocol'
import { attachmentFileName } from './run-images.ts'

/**
 * The transcript reducer (CLAUDE.md → "Transkrypt"). It folds one run's persisted lines, ordered
 * by `seq`, into renderable turns. It is a port of the cockpit's `reduceThread()`
 * (`packages/web/src/routes/task-thread/thread-state.ts`, tag `v0.11.0`), so a task reads the
 * same on the phone as on the laptop. Diff it against upstream when the contract is re-synced.
 *
 * Why a port and not a v2-only fold: `GET /history` returns the raw file, where protocol-v2
 * events (`item.*`, `turn.*`, `plan.updated`) sit interleaved with their v1 twins (`text`,
 * `tool-call`, `tool-result`) and with v1-only lines. A v2-only fold would lose the user's own
 * messages (`user-message` exists only in v1). A fold that took both would show every tool
 * twice. Upstream's rules:
 *
 *  - Lines with no v2 counterpart always render: `user-message`, `note`/`lifecycle`, `error`,
 *    `check-output`, the failed `step-end`, `provider-auth-required`, `image`.
 *  - Within a turn, **v2 wins for tools**: the first `item.*` event drops the turn's
 *    v1-synthesized tools and suppresses later ones.
 *  - v1 prose is dropped only when a v2 message **in the same turn** carries the same text.
 *    This is decided at the end of the fold, where the evidence exists. Prose that exists only
 *    in v1 renders rather than vanishing.
 *
 * Pure and total: a malformed line costs that line, never the fold, and an unknown `type` falls
 * into a `default` that renders nothing (rule 5, and the PRD's "renders generically or is
 * skipped"). `step()` is the per-event reducer. It mutates a private draft, because the
 * end-of-turn dedup needs the whole turn, and `reduceTranscript()` is the fold. S-06 appends
 * live events, `item.delta` included, and folds again.
 */

/** A dim/danger transcript line (v1 note/lifecycle/error, v2 non-fatal session.error). */
export interface TranscriptNote {
  kind: 'note'
  id: string
  text: string
  tone: 'dim' | 'danger'
}

/**
 * An image the run persisted. The v1 line records its URL in the unscoped
 * `/api/v1/runs/:id/images/:file` form, which the live host answers with 404, so only the stored
 * file name is kept. The view reads it from the project-scoped route (`run-images.ts`, #65).
 */
export interface TranscriptImage {
  kind: 'image'
  id: string
  /** The name the agent gave it, for the fallback line. */
  name?: string
  /** The stored file name under `images/`. Absent when the recorded URL has no plain one. */
  file?: string
}

/** A `CEZ:ASK` question. The next `user-message` resolves it and records the answer. */
export interface TranscriptAsk {
  kind: 'ask'
  id: string
  questions: UiAskQuestion[]
  resolved: boolean
  answer?: string
}

/** The provider's login lapsed mid-run. Fixing it is the cockpit's job. */
export interface TranscriptProviderAuth {
  kind: 'provider-auth-required'
  id: string
  provider: 'claude' | 'codex' | 'opencode' | 'pi'
}

export type TranscriptEntry =
  | UiItem
  | TranscriptNote
  | TranscriptImage
  | TranscriptAsk
  | TranscriptProviderAuth

export interface TranscriptTurn {
  /** Stable render key: the opening event's `seq`, or an ordinal for malformed content. */
  id: string
  turnId?: string
  /** The v1 `user-message` that opened this turn. The first turn has none: its prompt is the
   *  run's `task`. */
  userMessage?: { text: string; imageCount: number; ts?: string }
  startedAt?: string
  entries: TranscriptEntry[]
  /** Latest `plan.updated` snapshot seen during this turn (full replacement). */
  planEntries?: PlanEntry[]
  completed?: { stopReason: StopReason; costUsd?: number; ts?: string }
}

export interface Transcript {
  turns: TranscriptTurn[]
  /** v2 `session.ended`. The last one wins, because each step runs its own session. */
  sessionEnded?: { reason: StopReason; message?: string }
}

export interface ReduceOptions {
  /** The last turn still belongs to a running session. A trailing `CEZ:ASK` block is then
   *  provisional transport text, hidden until turn-end turns it into a card. */
  activeTurn?: boolean
}

/**
 * The plan to pin: the latest snapshot across all turns. An empty latest snapshot is returned
 * as it is. It replaced the plan with nothing, which is not the same as never having had one.
 */
export function latestPlan(transcript: Transcript): PlanEntry[] | undefined {
  for (let i = transcript.turns.length - 1; i >= 0; i -= 1) {
    const entries = transcript.turns[i]?.planEntries
    if (entries !== undefined) return entries
  }
  return undefined
}

/** `completed / total`, where a `cancelled` entry leaves the denominator (upstream's odometer). */
export function planProgress(entries: readonly PlanEntry[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const entry of entries) {
    if (entry.status === 'cancelled') continue
    total += 1
    if (entry.status === 'completed') done += 1
  }
  return { done, total }
}

/** What the strip under the transcript says (upstream's `threadFooter`). */
export type TranscriptFooter =
  | { state: 'waiting' }
  | { state: 'failed'; error?: string }
  | { state: 'review' }
  | { state: 'closed' }
  | null

export function transcriptFooter(status: string, error?: string): TranscriptFooter {
  switch (status) {
    case 'waiting':
      return { state: 'waiting' }
    case 'failed':
      return error ? { state: 'failed', error } : { state: 'failed' }
    case 'review':
      return { state: 'review' }
    case 'done':
    case 'cancelled':
      return { state: 'closed' }
    default:
      // queued/running, and any status this client has never heard of: say nothing rather
      // than guess.
      return null
  }
}

// ---- internals ----------------------------------------------------------------------------

interface DraftEntry {
  /** Lets the dedup drop exactly the v1-derived items once a turn turns out v2-covered. */
  origin: 'v1' | 'v2' | 'meta'
  entry: TranscriptEntry
}

interface DraftTurn {
  id: string
  turnId?: string
  userMessage?: TranscriptTurn['userMessage']
  startedAt?: string
  entries: DraftEntry[]
  planEntries?: PlanEntry[]
  completed?: TranscriptTurn['completed']
  /** True once any v2 `item.*` event landed in this turn: the dedup latch. */
  v2Items: boolean
}

export interface Draft {
  turns: DraftTurn[]
  /** stepId:itemId → live item. Sessions restart ids at `item_1` in every step. */
  itemsById: Map<string, { turn: DraftTurn; entry: DraftEntry }>
  sessionEnded?: Transcript['sessionEnded']
  turnSeq: number
  pendingAsk?: TranscriptAsk
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** A stamp the transcript is willing to render: absent or unparseable becomes `undefined`,
 *  never `Invalid Date`. */
function stamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  return Number.isFinite(new Date(value).getTime()) ? value : undefined
}

function providerId(value: unknown): TranscriptProviderAuth['provider'] | undefined {
  return value === 'claude' || value === 'codex' || value === 'opencode' || value === 'pi'
    ? value
    : undefined
}

const isAskQuestion = (value: unknown): value is UiAskQuestion =>
  isRecord(value) && typeof value.header === 'string' && Array.isArray(value.options)

/** Same key as upstream's `runItemKey`. Old recordings without a step id keep bare ids. */
function itemKey(stepId: string | undefined, itemId: string): string {
  return stepId === undefined ? itemId : `${stepId}:${itemId}`
}

/**
 * The engine's protocol markers (`CEZ:DONE`, `CEZ:MONITORING`, `CEZ:PR=`/`ISSUE=`/`TITLE=`).
 * v1 `text` arrives pre-stripped, while v2 messages carry them raw. `CEZ:ASK` is stripped only
 * when the turn holds the card, because otherwise the raw marker is the only place the question
 * exists.
 */
export function stripMarkers(text: string, stripAsk: boolean): string {
  let trailing = text.replace(/\s*CEZ:DONE\s*$/, '').replace(/\s*CEZ:MONITORING\s*$/, '')
  if (stripAsk) trailing = trailing.replace(/\s*CEZ:ASK[ \t]+\{[\s\S]*\}\s*$/, '')
  if (!trailing.includes('CEZ:')) return trailing
  return trailing
    .split('\n')
    .filter((line) => !/^CEZ:(?:PR=\d+|ISSUE=\d+|TITLE=.+)\s*$/.test(line))
    .join('\n')
}

/**
 * Legacy per-token transcripts persisted one v1 `text` per streaming token. A run of consecutive
 * v1 messages whose concatenation reassembles a v2 message of the turn is dropped as a whole.
 * Upstream's `dropLegacyDeltaRuns`.
 */
function dropLegacyDeltaRuns(draft: DraftTurn): void {
  const norm = (text: string) => stripMarkers(text, true).replace(/\s+/g, '')
  const v2Norms = new Set<string>()
  const inOrder: string[] = []
  for (const { origin, entry } of draft.entries) {
    if (origin === 'v2' && entry.kind === 'message') {
      const n = norm(entry.text)
      v2Norms.add(n)
      inOrder.push(n)
    }
  }
  if (inOrder.length === 0) return
  v2Norms.add(inOrder.join(''))
  const kept: DraftEntry[] = []
  let run: { entries: DraftEntry[]; texts: string[] } = { entries: [], texts: [] }
  const flushRun = () => {
    if (!(run.entries.length >= 2 && v2Norms.has(norm(run.texts.join(''))))) kept.push(...run.entries)
    run = { entries: [], texts: [] }
  }
  for (const e of draft.entries) {
    if (e.origin === 'v1' && e.entry.kind === 'message') {
      run.entries.push(e)
      run.texts.push(e.entry.text)
    } else {
      flushRun()
      kept.push(e)
    }
  }
  flushRun()
  draft.entries = kept
}

/** v1 tool results are strings today. Anything else renders as JSON rather than vanishing. */
function resultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const isUiItem = (entry: TranscriptEntry): entry is UiItem =>
  entry.kind === 'message' || entry.kind === 'reasoning' || entry.kind === 'tool'

const PLAN_STATUSES: ReadonlySet<string> = new Set<PlanStatus>([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
])

/** Pre-v2 transcripts carry the plan only as TodoWrite input. All-or-nothing, like upstream. */
function planFromTodos(input: unknown): PlanEntry[] | undefined {
  if (!isRecord(input) || !Array.isArray(input.todos)) return undefined
  const entries: PlanEntry[] = []
  for (const todo of input.todos) {
    if (!isRecord(todo) || typeof todo.content !== 'string') return undefined
    entries.push({
      content: todo.content,
      status: PLAN_STATUSES.has(todo.status as string) ? (todo.status as PlanStatus) : 'pending',
      ...(typeof todo.activeForm === 'string' ? { activeForm: todo.activeForm } : {}),
    })
  }
  return entries
}

function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

function inputField(input: unknown, ...keys: string[]): string | undefined {
  if (!isRecord(input)) return undefined
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return oneLine(value)
  }
  return undefined
}

/**
 * A title for a v1-only tool line, for recordings made before the v2 emitters existed. v2 items
 * carry the server's own `title`, so this is only the fallback. It is a small subset of
 * upstream's `toolDisplay()` (`api-client/src/protocol/tool-display.ts`), which is not part of
 * the vendored contract. Unknown tools keep their name.
 */
export function v1ToolDisplay(name: string, input: unknown): { toolKind: ToolKind; title: string } {
  const titled = (verb: string, label: string | undefined) => (label ? `${verb} ${label}` : verb)
  switch (name.toLowerCase()) {
    case 'bash':
    case 'commandexecution':
      return { toolKind: 'execute', title: titled('Ran', inputField(input, 'command')) }
    case 'edit':
    case 'multiedit':
      return { toolKind: 'edit', title: titled('Edit', inputField(input, 'file_path', 'filePath', 'path')) }
    case 'write':
      return { toolKind: 'edit', title: titled('Write', inputField(input, 'file_path', 'filePath', 'path')) }
    case 'read':
      return { toolKind: 'read', title: titled('Read', inputField(input, 'file_path', 'filePath', 'path')) }
    case 'glob':
    case 'grep':
      return { toolKind: 'search', title: titled('Search', inputField(input, 'pattern', 'query')) }
    case 'webfetch':
      return { toolKind: 'fetch', title: titled('Fetch', inputField(input, 'url')) }
    case 'websearch':
      return { toolKind: 'fetch', title: titled('Web search', inputField(input, 'query')) }
    case 'todowrite':
      return { toolKind: 'plan', title: 'Update plan' }
    default:
      return { toolKind: 'other', title: name }
  }
}

/** Codex collaboration bookkeeping has no user-facing meaning (upstream, same set). */
const CODEX_COLLAB_BOOKKEEPING = new Set(['subAgentActivity', 'collabAgentToolCall', 'collabToolCall'])

export function createDraft(): Draft {
  return { turns: [], itemsById: new Map(), turnSeq: 0 }
}

function newTurn(draft: Draft, sourceSeq?: number): DraftTurn {
  draft.turnSeq += 1
  const turn: DraftTurn = {
    id: sourceSeq === undefined ? `turn-fallback-${draft.turnSeq}` : `turn-seq-${sourceSeq}`,
    entries: [],
    v2Items: false,
  }
  draft.turns.push(turn)
  return turn
}

const currentTurn = (draft: Draft): DraftTurn => draft.turns.at(-1) ?? newTurn(draft)

function upsertV2(draft: Draft, turn: DraftTurn, raw: UiItem, key: string): void {
  // Clone: deltas append in place, and the event object off the wire must stay untouched.
  const item = { ...raw }
  if (!turn.v2Items) {
    // The latch flips: every v1-synthesized TOOL in this turn duplicates something v2 already
    // describes. v1 MESSAGES stay. Their twins are removed by text at the end of the fold.
    turn.v2Items = true
    for (const dropped of turn.entries) {
      if (dropped.origin === 'v1' && dropped.entry.kind === 'tool') draft.itemsById.delete(dropped.entry.id)
    }
    turn.entries = turn.entries.filter((e) => !(e.origin === 'v1' && e.entry.kind === 'tool'))
  }
  const existing = draft.itemsById.get(key)
  if (existing && existing.turn === turn) {
    existing.entry.entry = item
    return
  }
  const entry: DraftEntry = { origin: 'v2', entry: item }
  turn.entries.push(entry)
  draft.itemsById.set(key, { turn, entry })
}

function pushMeta(draft: Draft, entry: TranscriptEntry): void {
  currentTurn(draft).entries.push({ origin: 'meta', entry })
}

/** The per-event reducer. Never throws: every payload field is checked before it is trusted. */
export function step(draft: Draft, event: RunEvent): Draft {
  switch (event.type) {
    // ---- turn boundaries ------------------------------------------------------------------
    case 'user-message': {
      const text = str(event.text) ?? ''
      if (draft.pendingAsk && !draft.pendingAsk.resolved) {
        draft.pendingAsk.resolved = true
        if (text !== '') draft.pendingAsk.answer = text
        draft.pendingAsk = undefined
      }
      const turn = newTurn(draft, event.seq)
      const ts = stamp(event.ts)
      turn.userMessage = {
        text,
        imageCount: typeof event.imageCount === 'number' ? event.imageCount : 0,
        ...(ts !== undefined ? { ts } : {}),
      }
      if (ts !== undefined) turn.startedAt = ts
      break
    }
    case 'turn.started': {
      const current = draft.turns.at(-1)
      // The v1 `user-message` precedes the v2 `turn.started` of the same turn: attach to it.
      const attached =
        current && current.turnId === undefined && !current.v2Items ? current : newTurn(draft, event.seq)
      attached.turnId = str(event.turnId)
      const startedAt = stamp(event.ts)
      if (attached.startedAt === undefined && startedAt !== undefined) attached.startedAt = startedAt
      break
    }
    case 'turn.completed': {
      const turnId = str(event.turnId)
      // Newest match first: turn ids repeat across steps.
      let matched: DraftTurn | undefined
      for (let i = draft.turns.length - 1; i >= 0 && !matched; i -= 1) {
        if (draft.turns[i]?.turnId === turnId) matched = draft.turns[i]
      }
      const turn = matched ?? draft.turns.at(-1)
      if (turn) {
        const ts = stamp(event.ts)
        turn.completed = {
          stopReason: (str(event.stopReason) ?? 'end_turn') as StopReason,
          ...(typeof event.costUsd === 'number' ? { costUsd: event.costUsd } : {}),
          ...(ts !== undefined ? { ts } : {}),
        }
      }
      break
    }

    // ---- v2 items -------------------------------------------------------------------------
    case 'item.started':
    case 'item.updated':
    case 'item.completed': {
      // An unknown `kind` would render a blank row, and a missing id would key every such item
      // to the same slot. Both are dropped.
      if (!isRecord(event.item)) break
      const { kind, id } = event.item
      if ((kind !== 'message' && kind !== 'reasoning' && kind !== 'tool') || typeof id !== 'string' || id === '') {
        break
      }
      const item = event.item as unknown as UiItem
      const key = itemKey(event.stepId, id)
      upsertV2(draft, draft.itemsById.get(key)?.turn ?? currentTurn(draft), item, key)
      break
    }
    case 'item.delta': {
      const located = draft.itemsById.get(itemKey(event.stepId, str(event.itemId) ?? ''))
      const delta = str(event.delta) ?? ''
      if (!located || delta === '' || !isUiItem(located.entry.entry)) break
      const item = located.entry.entry
      if (event.field === 'output' && item.kind === 'tool') {
        item.output = (item.output ?? '') + delta
      } else if (event.field !== 'output' && item.kind !== 'tool') {
        item.text += delta
      }
      break
    }

    // ---- v1 fallback items (skipped once the turn is v2-covered) ---------------------------
    case 'text': {
      const text = str(event.text) ?? ''
      if (text === '') break
      currentTurn(draft).entries.push({
        origin: 'v1',
        entry: { kind: 'message', id: `v1:${event.seq}`, role: 'assistant', text },
      })
      break
    }
    case 'tool-call': {
      const turn = currentTurn(draft)
      if (turn.v2Items) break
      const name = str(event.tool) ?? 'Tool'
      if (CODEX_COLLAB_BOOKKEEPING.has(name)) break
      const display = v1ToolDisplay(name, event.input)
      if (display.toolKind === 'plan') {
        const plan = planFromTodos(event.input)
        if (plan !== undefined) turn.planEntries = plan
      }
      const item: UiToolItem = {
        kind: 'tool',
        id: str(event.id) ?? `v1:${event.seq}`,
        name,
        toolKind: display.toolKind,
        title: display.title,
        status: 'running',
        input: event.input,
      }
      const entry: DraftEntry = { origin: 'v1', entry: item }
      turn.entries.push(entry)
      draft.itemsById.set(item.id, { turn, entry })
      break
    }
    case 'tool-result': {
      const located = draft.itemsById.get(str(event.toolCallId) ?? '')
      if (!located || located.turn.v2Items || located.entry.origin !== 'v1') break
      const item = located.entry.entry
      if (item.kind !== 'tool') break
      item.status = 'completed'
      item.output = resultText(event.result)
      break
    }

    // ---- lines that always render ----------------------------------------------------------
    case 'note':
    case 'lifecycle': {
      const text = str(event.message) ?? ''
      if (text === '') break
      pushMeta(draft, { kind: 'note', id: `v1:${event.seq}`, text, tone: event.tone === 'danger' ? 'danger' : 'dim' })
      break
    }
    case 'error': {
      const text = str(event.message) ?? ''
      if (text === '') break
      pushMeta(draft, { kind: 'note', id: `v1:${event.seq}`, text, tone: 'danger' })
      break
    }
    case 'session.error': {
      const text = str(event.message) ?? ''
      if (text === '') break
      pushMeta(draft, { kind: 'note', id: `v2:${event.seq}`, text, tone: 'danger' })
      break
    }
    case 'step-end': {
      // Steps are header material, except the one thing the transcript must not hide.
      if (event.status !== 'failed') break
      const suffix = str(event.error) ? ` — ${str(event.error)}` : ''
      pushMeta(draft, {
        kind: 'note',
        id: `v1:${event.seq}`,
        text: `step ${str(event.stepId) ?? '?'} failed${suffix}`,
        tone: 'danger',
      })
      break
    }
    case 'check-output': {
      // A check step's command (v1-only: check steps spawn no agent session).
      const command = str(event.command) ?? 'check'
      const exitCode = typeof event.exitCode === 'number' ? event.exitCode : -1
      pushMeta(draft, {
        kind: 'tool',
        id: `v1:${event.seq}`,
        name: 'check',
        toolKind: 'execute',
        title: `Ran ${command}`,
        status: exitCode === 0 ? 'completed' : 'failed',
        output: str(event.text) ?? '',
        exitCode,
      })
      break
    }
    case 'provider-auth-required': {
      const provider = providerId(event.provider)
      const authFailureId = str(event.authFailureId)
      if (provider === undefined || authFailureId === undefined || authFailureId.length < 1) break
      pushMeta(draft, { kind: 'provider-auth-required', id: `v1:${event.seq}`, provider })
      break
    }
    case 'image': {
      // Upstream renders only the v1 line (it carries the stored file). Same gate here.
      const url = str(event.url)
      if (url === undefined) break
      const name = str(event.name)
      const file = attachmentFileName(url)
      pushMeta(draft, {
        kind: 'image',
        id: `v1:${event.seq}`,
        ...(name !== undefined ? { name } : {}),
        ...(file !== undefined ? { file } : {}),
      })
      break
    }

    // ---- session-level ---------------------------------------------------------------------
    case 'plan.updated': {
      if (Array.isArray(event.entries)) {
        currentTurn(draft).planEntries = (event.entries as unknown[]).filter(
          (entry): entry is PlanEntry => isRecord(entry) && typeof entry.content === 'string',
        )
      }
      break
    }
    case 'session.ended': {
      const message = str(event.message)
      draft.sessionEnded = {
        reason: (str(event.reason) ?? 'end_turn') as StopReason,
        ...(message !== undefined ? { message } : {}),
      }
      break
    }
    case 'ask.requested': {
      const requestId = str(event.requestId)
      if (requestId === undefined || !Array.isArray(event.questions)) break
      const questions = (event.questions as unknown[]).filter(isAskQuestion)
      if (questions.length === 0) break
      const ask: TranscriptAsk = { kind: 'ask', id: requestId, questions, resolved: false }
      pushMeta(draft, ask)
      draft.pendingAsk = ask
      break
    }

    // Deliberate suppressions, each owned by another surface: steps (the header), token and
    // cost ticks (the header's running totals), engine control flow, session ids.
    case 'step-start':
    case 'token-usage':
    case 'cost':
    case 'turn-end':
    case 'done':
    case 'session':
      break

    // session.started, usage.updated, permission.* and anything a newer Cezar adds: never
    // guessed at in the body (rule 5).
    default:
      break
  }
  return draft
}

/** Resolve the end-of-turn dedup and freeze the draft into what the screen renders. */
export function finish(draft: Draft, options: ReduceOptions = {}): Transcript {
  for (const turn of draft.turns) {
    if (!turn.v2Items) continue
    const v2Texts = new Set<string>()
    for (const { origin, entry } of turn.entries) {
      if (origin === 'v2' && entry.kind === 'message') v2Texts.add(stripMarkers(entry.text, true).trim())
    }
    if (v2Texts.size === 0) continue
    turn.entries = turn.entries.filter(
      (e) => !(e.origin === 'v1' && e.entry.kind === 'message' && v2Texts.has(stripMarkers(e.entry.text, true).trim())),
    )
    dropLegacyDeltaRuns(turn)
  }

  return {
    turns: draft.turns.map((turn, index) => {
      const hasAskCard = turn.entries.some(({ entry }) => entry.kind === 'ask')
      const provisionalAsk = options.activeTurn === true && index === draft.turns.length - 1
      return {
        id: turn.id,
        ...(turn.turnId !== undefined ? { turnId: turn.turnId } : {}),
        ...(turn.userMessage !== undefined ? { userMessage: turn.userMessage } : {}),
        ...(turn.startedAt !== undefined ? { startedAt: turn.startedAt } : {}),
        ...(turn.planEntries !== undefined ? { planEntries: turn.planEntries } : {}),
        ...(turn.completed !== undefined ? { completed: turn.completed } : {}),
        entries: turn.entries.map(({ entry }) =>
          entry.kind === 'message' && entry.role === 'assistant'
            ? { ...entry, text: stripMarkers(entry.text, hasAskCard || provisionalAsk) }
            : entry,
        ),
      }
    }),
    ...(draft.sessionEnded !== undefined ? { sessionEnded: draft.sessionEnded } : {}),
  }
}

/** Fold an ordered event list into a transcript. */
export function reduceTranscript(events: readonly RunEvent[], options: ReduceOptions = {}): Transcript {
  const draft = createDraft()
  for (const event of events) {
    // A line that is not even an object costs itself. The rest is `step`'s job.
    if (isRecord(event) && typeof event.type === 'string') step(draft, event)
  }
  return finish(draft, options)
}

/**
 * Merge event lists by `seq`, later lists winning, in `seq` order. Used for the pinned plan,
 * which folds `history-context` together with the page (upstream's `currentEvents`).
 */
export function mergeBySeq(...groups: readonly (readonly RunEvent[])[]): RunEvent[] {
  const bySeq = new Map<number, RunEvent>()
  for (const group of groups) {
    for (const event of group) if (typeof event?.seq === 'number') bySeq.set(event.seq, event)
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
