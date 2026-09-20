import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumeUnlockOutcome, resetUnlockOutcome } from './unlock.ts'

function land(url: string) {
  window.history.replaceState(null, '', url)
}

beforeEach(() => {
  resetUnlockOutcome()
})

afterEach(() => {
  land('/m/')
  resetUnlockOutcome()
})

describe('consumeUnlockOutcome', () => {
  it('reports failure and strips the key when the gateway ignored it', () => {
    // We asked the gateway to unlock and it handed us back the shell with the
    // key untouched — so nothing in front of /m/ matched it.
    land('/m/?key=s3cret')

    expect(consumeUnlockOutcome()).toBe(true)
    expect(window.location.search).toBe('')
    expect(window.location.href).not.toContain('s3cret')
  })

  it('reports success on a clean URL — the gateway consumed the key and redirected', () => {
    land('/m/')
    expect(consumeUnlockOutcome()).toBe(false)
  })

  it('keeps answering the same way after the strip', () => {
    // React StrictMode renders twice; the second read must not mistake the URL
    // it just cleaned for a load that never carried a key.
    land('/m/?key=s3cret')

    expect(consumeUnlockOutcome()).toBe(true)
    expect(consumeUnlockOutcome()).toBe(true)
  })

  it('leaves the rest of the URL alone', () => {
    land('/m/run/proj/abc?key=s3cret&tab=diff')

    expect(consumeUnlockOutcome()).toBe(true)
    expect(window.location.pathname).toBe('/m/run/proj/abc')
    expect(window.location.search).toBe('?tab=diff')
  })

  it('does not touch history when there was no key', () => {
    land('/m/?tab=diff')

    expect(consumeUnlockOutcome()).toBe(false)
    expect(window.location.search).toBe('?tab=diff')
  })
})
