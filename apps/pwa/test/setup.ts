import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom does not implement matchMedia, and `useStandalone` calls it on every
// render. The default answers "not standalone" — i.e. a plain browser tab;
// tests that need the installed case override this per test.
if (!window.matchMedia) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

// Testing Library only registers its own cleanup when Vitest globals are on.
// They are off here, so unmount between tests by hand — otherwise each render
// stacks onto the previous one's DOM.
afterEach(cleanup)
