import { describe, expect, it, vi } from 'vitest'
import { applyBadge, badgeSupported } from './app-badge.ts'

const both = () => ({ setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) })

describe('badgeSupported', () => {
  it.each([
    ['both methods', both(), true],
    ['neither', {}, false],
    ['only set', { setAppBadge: async () => {} }, false],
    ['only clear', { clearAppBadge: async () => {} }, false],
    ['a non-function', { setAppBadge: 3, clearAppBadge: async () => {} }, false],
  ])('%s → %s', (_name, nav, expected) => {
    expect(badgeSupported(nav)).toBe(expected)
  })
})

describe('applyBadge', () => {
  it('sets the count', async () => {
    const nav = both()
    expect(await applyBadge(nav, 3)).toEqual({ ok: true })
    expect(nav.setAppBadge).toHaveBeenCalledWith(3)
    expect(nav.clearAppBadge).not.toHaveBeenCalled()
  })

  it('clears on null', async () => {
    const nav = both()
    expect(await applyBadge(nav, null)).toEqual({ ok: true })
    expect(nav.clearAppBadge).toHaveBeenCalledOnce()
    expect(nav.setAppBadge).not.toHaveBeenCalled()
  })

  it('says unsupported without calling anything', async () => {
    expect(await applyBadge({}, 3)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('returns a rejection as data instead of throwing', async () => {
    const nav = both()
    nav.setAppBadge.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError'))
    expect(await applyBadge(nav, 3)).toEqual({ ok: false, reason: 'failed', message: 'NotAllowedError: Not allowed' })
  })

  it('reads a rejection that is not an Error', async () => {
    const nav = both()
    nav.clearAppBadge.mockRejectedValueOnce('nope')
    expect(await applyBadge(nav, null)).toEqual({ ok: false, reason: 'failed', message: 'nope' })
  })
})
