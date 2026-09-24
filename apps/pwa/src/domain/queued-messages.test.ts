import type { QueuedMessage } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import { dropQueuedMessage, queuedMessageRefusal, queuedMessagesEditable, replaceQueuedMessage } from './queued-messages.ts'

const msg = (id: string, text = id): QueuedMessage => ({ id, text, createdAt: '2026-09-24T08:00:00.000Z' })
const stack = [msg('a'), msg('b'), msg('c')]

describe('queuedMessagesEditable', () => {
  it.each([
    ['queued', true],
    ['running', false],
    ['waiting', false],
    ['done', false],
    ['some-future-status', false],
  ])('%s → %s', (status, editable) => {
    expect(queuedMessagesEditable(status)).toBe(editable)
  })
})

describe('replaceQueuedMessage', () => {
  it('keeps the entry in its place', () => {
    expect(replaceQueuedMessage(stack, msg('b', 'B!')).map((m) => m.text)).toEqual(['a', 'B!', 'c'])
  })

  it('leaves the stack as it is when the id is gone', () => {
    expect(replaceQueuedMessage(stack, msg('z'))).toBe(stack)
  })
})

describe('dropQueuedMessage', () => {
  it.each([
    ['a', ['b', 'c']],
    ['b', ['a', 'c']],
    ['c', ['a', 'b']],
  ])('drops %s', (id, left) => {
    expect(dropQueuedMessage(stack, id).map((m) => m.id)).toEqual(left)
  })

  it('leaves the stack as it is when the id is gone', () => {
    expect(dropQueuedMessage(stack, 'z')).toBe(stack)
  })
})

describe('queuedMessageRefusal', () => {
  it.each([
    [404, 'already-sent'],
    [409, 'already-sent'],
    [400, 'refused'],
    [500, 'refused'],
  ])('%i → %s', (status, kind) => {
    expect(queuedMessageRefusal(status)).toBe(kind)
  })
})
