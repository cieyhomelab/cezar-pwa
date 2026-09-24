import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFollowBottom } from './useFollowBottom.ts'

/** A reader scrolled well above the end: 2000 px of content, the viewport at its top. */
let scrollHeight = 2000
let scrollTo: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  scrollHeight = 2000
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => scrollHeight)
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0)
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const follow = (initial: { signature: string; reach?: number }) =>
  renderHook(({ signature, reach }: { signature: string; reach?: number }) => useFollowBottom(signature, true, reach), {
    initialProps: initial,
  })

describe('useFollowBottom — content above (FR-049)', () => {
  it('announces new lines at the end to a reader scrolled up', () => {
    const { result, rerender } = follow({ signature: 'a', reach: 50 })
    rerender({ signature: 'b', reach: 50 })
    expect(result.current.unseen).toBe(true)
  })

  it('does not announce an older page landing above, even inside one long turn', () => {
    // Same opener before and after (the first line's seq unchanged); the reach moves back.
    const { result, rerender } = follow({ signature: 'a', reach: 50 })
    rerender({ signature: 'b', reach: 10 })
    expect(result.current.unseen).toBe(false)
  })

  it('follows a reader at the end when a refetch moves the reach forward', () => {
    const { rerender } = follow({ signature: 'a', reach: 10 })
    scrollTo.mockClear()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(scrollHeight - window.innerHeight)
    rerender({ signature: 'b', reach: 60 })
    expect(scrollTo).toHaveBeenCalled()
  })
})
