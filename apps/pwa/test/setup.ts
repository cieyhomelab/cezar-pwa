import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only registers its own cleanup when Vitest globals are on.
// They are off here, so unmount between tests by hand — otherwise each render
// stacks onto the previous one's DOM.
afterEach(cleanup)
