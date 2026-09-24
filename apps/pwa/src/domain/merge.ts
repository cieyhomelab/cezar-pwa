import type {
  GithubMergeMethod,
  GithubPrCheck,
  GithubPrMergeState,
  GithubPrMergeStateResponse,
} from '@cezar-pwa/cezar-contract/contract'

/**
 * S-19 (#69): what the task screen says about its pull request, and whether it may merge it.
 *
 * Read from `GET …/github/prs/:number/merge-state` (`githubPrMergeStateSchema`). The server has
 * already judged eligibility — `canMerge`, `canOverride` and the ordered `blockers` — the same way
 * it will judge the merge itself, so this module only re-words that judgement for a phone. It never
 * loosens it: the phone offers a merge exactly when the server would accept one.
 *
 * Every enum is read defensively (rule 5): an eligibility, check state or method this build does
 * not know degrades to "unknown" or is dropped, never thrown on.
 */

export type MergeHeadline = 'merged' | 'closed' | 'draft' | 'conflicts' | 'ready' | 'failing' | 'pending' | 'blocked' | 'unknown'

export type CheckState = GithubPrCheck['state']

export interface MergeCheck {
  name: string
  state: CheckState
  required: boolean | null
  url?: string
}

export interface MergeView {
  number: number
  title: string
  url: string
  baseRef: string
  headSha: string
  headline: MergeHeadline
  /** Failing first, then pending, unknown, passing — what needs a look comes first. */
  checks: MergeCheck[]
  counts: Record<CheckState, number>
  /** The server's reasons, in its order, verbatim (FR-032). */
  blockers: string[]
  methods: GithubMergeMethod[]
  defaultMethod: GithubMergeMethod | null
  canMerge: boolean
  canOverride: boolean
  /** Merged or closed: nothing will change, so nothing is re-asked. */
  terminal: boolean
}

const CHECK_STATES: readonly CheckState[] = ['failing', 'pending', 'unknown', 'passing']
const METHODS: readonly GithubMergeMethod[] = ['squash', 'merge', 'rebase']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function checkState(value: unknown): CheckState {
  return CHECK_STATES.includes(value as CheckState) ? (value as CheckState) : 'unknown'
}

function isMethod(value: unknown): value is GithubMergeMethod {
  return METHODS.includes(value as GithubMergeMethod)
}

/** A details link is data GitHub (and a workflow author) chose: only `http(s)` becomes a link. */
function httpUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined
}

function readChecks(value: unknown): MergeCheck[] {
  if (!Array.isArray(value)) return []
  const checks: MergeCheck[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.name !== 'string') continue
    const url = httpUrl(raw.url)
    checks.push({
      name: raw.name,
      state: checkState(raw.state),
      required: typeof raw.required === 'boolean' ? raw.required : null,
      ...(url ? { url } : {}),
    })
  }
  const rank = (check: MergeCheck) => CHECK_STATES.indexOf(check.state)
  return checks.map((check, index) => ({ check, index })).sort((a, b) => rank(a.check) - rank(b.check) || a.index - b.index).map(({ check }) => check)
}

/**
 * The one line the panel leads with. Terminal and structural states win over checks, as the
 * server orders its blockers: a draft with a failing check is a draft first.
 */
export function mergeHeadline(state: Pick<GithubPrMergeState, 'state' | 'isDraft' | 'mergeable' | 'eligibility' | 'canMerge'> & { checks: { state: string }[] }): MergeHeadline {
  if (state.state === 'merged') return 'merged'
  if (state.state === 'closed') return 'closed'
  if (state.isDraft) return 'draft'
  if (state.mergeable === 'conflicting') return 'conflicts'
  if (state.canMerge) return 'ready'
  if (state.checks.some((check) => check.state === 'failing')) return 'failing'
  if (state.eligibility === 'pending' || state.checks.some((check) => check.state === 'pending')) return 'pending'
  if (state.eligibility === 'blocked') return 'blocked'
  return 'unknown'
}

/**
 * The panel's view of one merge-state answer, or `null` when the answer is not one (a shape this
 * build cannot read). `available: false` is handled by the caller: it carries a reason, not a PR.
 */
export function mergeView(raw: unknown): MergeView | null {
  if (!isRecord(raw)) return null
  const { number, title, url, headSha } = raw
  if (typeof number !== 'number' || typeof title !== 'string' || typeof headSha !== 'string') return null
  const checks = readChecks(raw.checks)
  const counts: Record<CheckState, number> = { failing: 0, pending: 0, unknown: 0, passing: 0 }
  for (const check of checks) counts[check.state] += 1
  const state = raw.state === 'merged' || raw.state === 'closed' ? raw.state : 'open'
  const methods = Array.isArray(raw.methods) ? raw.methods.filter(isMethod) : []
  const defaultMethod = isMethod(raw.defaultMethod) && methods.includes(raw.defaultMethod) ? raw.defaultMethod : null
  const blockers = Array.isArray(raw.blockers)
    ? raw.blockers.flatMap((blocker) => (isRecord(blocker) && typeof blocker.message === 'string' ? [blocker.message] : []))
    : []
  const open = state === 'open'
  return {
    number,
    title,
    url: typeof url === 'string' ? url : '',
    baseRef: typeof raw.baseRef === 'string' ? raw.baseRef : '',
    headSha,
    headline: mergeHeadline({
      state,
      isDraft: raw.isDraft === true,
      mergeable: raw.mergeable === 'conflicting' ? 'conflicting' : raw.mergeable === 'mergeable' ? 'mergeable' : 'unknown',
      eligibility: typeof raw.eligibility === 'string' ? (raw.eligibility as GithubPrMergeState['eligibility']) : 'unknown',
      canMerge: raw.canMerge === true,
      checks,
    }),
    checks,
    counts,
    blockers,
    methods,
    defaultMethod,
    // Both flags are the server's, and only ever narrowed here: never on a closed PR, never without a method.
    canMerge: open && raw.canMerge === true && methods.length > 0,
    canOverride: open && raw.canMerge !== true && raw.canOverride === true && methods.length > 0,
    terminal: !open,
  }
}

export type MergePanelState =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'unreadable' }
  | { kind: 'other-pr' }
  | { kind: 'state'; view: MergeView }

/**
 * The merge-state answer for the PR the task links to. `prUrl` is the link the header shows: the
 * route is scoped to the project's repository, so a task whose PR lives in another repository would
 * be answered about a different PR with the same number. Such an answer is never offered a merge.
 */
export function mergePanelState(response: GithubPrMergeStateResponse | unknown, prUrl: string): MergePanelState {
  if (!isRecord(response)) return { kind: 'unreadable' }
  if (response.available === false) {
    return { kind: 'unavailable', reason: typeof response.reason === 'string' ? response.reason : '' }
  }
  const view = response.available === true ? mergeView(response.mergeState) : null
  if (view === null) return { kind: 'unreadable' }
  if (view.url !== '' && !samePullRequest(view.url, prUrl)) return { kind: 'other-pr' }
  return { kind: 'state', view }
}

/** `https://github.com/O/R/pull/7` and `…/pull/7/files` name the same PR; owner and repo case-insensitively. */
export function samePullRequest(a: string, b: string): boolean {
  const key = (url: string) => {
    const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/i.exec(url.trim())
    return match ? `${match[1]}/${match[2]}/${match[3]}/${match[4]}`.toLowerCase() : null
  }
  const left = key(a)
  return left !== null && left === key(b)
}

/** The method the confirmation starts on: the operator's pick while still allowed, else the repository's default. */
export function selectedMethod(view: Pick<MergeView, 'methods' | 'defaultMethod'>, chosen: GithubMergeMethod | undefined): GithubMergeMethod | null {
  if (chosen && view.methods.includes(chosen)) return chosen
  return view.defaultMethod ?? view.methods[0] ?? null
}

export type MergeGate = { allowed: true; override: boolean } | { allowed: false; reason: string | null }

/**
 * Whether the phone offers the merge button, and if not, the reason it leads with. `override` is
 * the operator's "merge without waiting for requirements" — honoured only when the server says it
 * may be (`canOverride`: open, not a draft, no conflicts). The first blocker is the server's own
 * reason; a PR with no blocker and no merge has none to give.
 */
export function mergeGate(view: Pick<MergeView, 'canMerge' | 'canOverride' | 'blockers' | 'methods'>, override: boolean): MergeGate {
  if (view.methods.length === 0) return { allowed: false, reason: view.blockers[0] ?? null }
  if (view.canMerge) return { allowed: true, override: false }
  if (view.canOverride && override) return { allowed: true, override: true }
  return { allowed: false, reason: view.blockers[0] ?? null }
}
