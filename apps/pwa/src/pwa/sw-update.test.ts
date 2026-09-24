import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_MIN_INTERVAL_MS, watchForUpdates } from './sw-update.ts'

let visibility: DocumentVisibilityState = 'visible'
let clock = 0
const now = () => clock

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

const registration = () => ({ update: vi.fn(async () => undefined) })

let stop: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})

afterEach(() => {
  stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('watchForUpdates', () => {
  it('checks when the app comes back to the foreground (the iOS resume)', () => {
    const reg = registration()
    stop = watchForUpdates(reg, { now })
    setVisibility('hidden')
    clock += UPDATE_CHECK_MIN_INTERVAL_MS
    setVisibility('visible')
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('does not check again within a minute of the last check', () => {
    const reg = registration()
    stop = watchForUpdates(reg, { now })
    // Right after registering: the registration just checked on its own.
    setVisibility('visible')
    expect(reg.update).not.toHaveBeenCalled()

    clock += UPDATE_CHECK_MIN_INTERVAL_MS
    setVisibility('visible')
    clock += 1_000
    setVisibility('visible')
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('never checks while hidden', () => {
    const reg = registration()
    stop = watchForUpdates(reg, { now })
    clock += UPDATE_CHECK_INTERVAL_MS
    setVisibility('hidden')
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(reg.update).not.toHaveBeenCalled()
  })

  it('checks hourly while the app stays open', () => {
    const reg = registration()
    stop = watchForUpdates(reg, { now })
    clock += UPDATE_CHECK_INTERVAL_MS
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed check (offline) and tries again next time', async () => {
    const reg = { update: vi.fn(async () => Promise.reject(new Error('offline'))) }
    stop = watchForUpdates(reg, { now })
    clock += UPDATE_CHECK_MIN_INTERVAL_MS
    setVisibility('visible')
    await Promise.resolve()
    clock += UPDATE_CHECK_MIN_INTERVAL_MS
    setVisibility('visible')
    expect(reg.update).toHaveBeenCalledTimes(2)
  })

  it('watches a registration once, however often it is handed over', () => {
    const reg = registration()
    stop = watchForUpdates(reg, { now })
    const second = watchForUpdates(reg, { now })
    clock += UPDATE_CHECK_MIN_INTERVAL_MS
    setVisibility('visible')
    expect(reg.update).toHaveBeenCalledTimes(1)
    second()
  })

  it('stops on teardown', () => {
    const reg = registration()
    watchForUpdates(reg, { now })()
    clock += UPDATE_CHECK_MIN_INTERVAL_MS
    setVisibility('visible')
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(reg.update).not.toHaveBeenCalled()
  })
})
