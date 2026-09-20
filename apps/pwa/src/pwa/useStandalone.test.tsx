import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStandalone } from './useStandalone.ts'

const realMatchMedia = window.matchMedia

function setDisplayMode(standalone: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  window.matchMedia = realMatchMedia
  delete (window.navigator as { standalone?: boolean }).standalone
})

function Probe() {
  return <span>{useStandalone() ? 'installed' : 'tab'}</span>
}

describe('useStandalone', () => {
  it('reports a plain browser tab by default', () => {
    setDisplayMode(false)
    render(<Probe />)
    expect(screen.getByText('tab')).toBeInTheDocument()
  })

  it('detects the standard display-mode media feature', () => {
    setDisplayMode(true)
    render(<Probe />)
    expect(screen.getByText('installed')).toBeInTheDocument()
  })

  it("detects iOS Safari's navigator.standalone, which is often the only signal", () => {
    setDisplayMode(false)
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      get: () => true,
    })
    render(<Probe />)
    expect(screen.getByText('installed')).toBeInTheDocument()
  })

  it('survives a browser with no matchMedia at all', () => {
    // @ts-expect-error — deliberately modelling an engine that lacks it.
    window.matchMedia = undefined
    render(<Probe />)
    expect(screen.getByText('tab')).toBeInTheDocument()
  })
})
