import type { QueuedMessage } from '@cezar-pwa/cezar-contract/contract'

/**
 * #66: the messages stacked onto a task that has not started yet, edited or removed before the
 * agent picks them up. Cezar folds the stack into the prompt when the task starts and keeps it on
 * the record for the life of the run, so the stack stays visible afterwards, read-only: the
 * routes answer `409 run already started` from then on.
 */
export function queuedMessagesEditable(status: string): boolean {
  return status === 'queued'
}

/** The stack with `message` in its old place. An id no longer on the stack changes nothing. */
export function replaceQueuedMessage(
  stack: readonly QueuedMessage[],
  message: QueuedMessage,
): readonly QueuedMessage[] {
  if (!stack.some((entry) => entry.id === message.id)) return stack
  return stack.map((entry) => (entry.id === message.id ? message : entry))
}

/** The stack without `id`. An id no longer on the stack changes nothing. */
export function dropQueuedMessage(stack: readonly QueuedMessage[], id: string): readonly QueuedMessage[] {
  if (!stack.some((entry) => entry.id === id)) return stack
  return stack.filter((entry) => entry.id !== id)
}

/**
 * Why an edit or removal did not apply, by the status Cezar answered. `404` means the message is
 * no longer on the stack and `409` that the task has started; both mean the agent already has
 * the message, which is not the operator's failure. Anything else is a refusal to show.
 */
export function queuedMessageRefusal(status: number): 'already-sent' | 'refused' {
  return status === 404 || status === 409 ? 'already-sent' : 'refused'
}
