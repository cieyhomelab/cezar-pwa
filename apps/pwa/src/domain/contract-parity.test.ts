import type { RunIndexEntry, RunStatus as ContractRunStatus } from '@cezar-pwa/cezar-contract/contract'
import type { AttentionInput, ReadStateInput, RunStatus } from '@cezar-pwa/shared'
import { describe, expect, it } from 'vitest'

/**
 * `packages/shared` spells out the run vocabulary instead of importing the contract (it is
 * built to `dist/` for the sidecar; the contract is source only). These are compile-time
 * checks that the spelling still matches: `npm run typecheck` fails when they drift.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const statusesMatch: Equal<RunStatus, ContractRunStatus> = true

// A slim index row must satisfy both shared rules — the list calls them with one.
const asAttention = (run: RunIndexEntry): AttentionInput => run
const asReadState = (run: RunIndexEntry): ReadStateInput => run

describe('shared ↔ contract parity', () => {
  it('holds at compile time', () => {
    expect([statusesMatch, typeof asAttention, typeof asReadState]).toEqual([true, 'function', 'function'])
  })
})
