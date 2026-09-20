import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus.ts'

/**
 * jsdom exposes `onLine` as a getter on Navigator.prototype. Shadowing it with
 * a configurable own property lets each test pick an answer; deleting it again
 * hands the prototype getter back.
 */
function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  })
}

afterEach(() => {
  delete (window.navigator as { onLine?: boolean }).onLine
})

function Probe() {
  return <span>{useOnlineStatus() ? 'online' : 'offline'}</span>
}

describe('useOnlineStatus', () => {
  it('starts from what the browser reports', () => {
    setOnLine(false)
    render(<Probe />)
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  it('goes offline when the browser fires the event', () => {
    setOnLine(true)
    render(<Probe />)
    expect(screen.getByText('online')).toBeInTheDocument()

    setOnLine(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  it('recovers when the network comes back', () => {
    setOnLine(false)
    render(<Probe />)

    setOnLine(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.getByText('online')).toBeInTheDocument()
  })

  it('survives the network flapping', () => {
    setOnLine(true)
    render(<Probe />)

    for (const up of [false, true, false]) {
      setOnLine(up)
      act(() => {
        window.dispatchEvent(new Event(up ? 'online' : 'offline'))
      })
      expect(screen.getByText(up ? 'online' : 'offline')).toBeInTheDocument()
    }
  })

  it('detaches both listeners on unmount', () => {
    setOnLine(true)
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Probe />)
    unmount()

    const removed = remove.mock.calls.map(([type]) => type)
    expect(removed).toContain('online')
    expect(removed).toContain('offline')
    remove.mockRestore()
  })
})
