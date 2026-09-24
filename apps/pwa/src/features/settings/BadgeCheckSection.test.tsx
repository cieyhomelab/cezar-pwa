import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../i18n/en.ts'
import { BadgeCheckSection } from './BadgeCheckSection.tsx'

/** #68: the temporary on-device badge check. The badge itself is the device's to show. */

const t = en.settings.badge
type BadgeNav = Navigator & { standalone?: boolean; setAppBadge?: unknown; clearAppBadge?: unknown }
const nav = window.navigator as BadgeNav

let setAppBadge: ReturnType<typeof vi.fn>
let clearAppBadge: ReturnType<typeof vi.fn>

beforeEach(() => {
  nav.standalone = true
  setAppBadge = vi.fn(async () => {})
  clearAppBadge = vi.fn(async () => {})
  nav.setAppBadge = setAppBadge
  nav.clearAppBadge = clearAppBadge
})

afterEach(() => {
  delete nav.standalone
  delete nav.setAppBadge
  delete nav.clearAppBadge
})

describe('BadgeCheckSection', () => {
  it('in a browser tab, only says to open the installed app', () => {
    delete nav.standalone
    render(<BadgeCheckSection />)
    expect(screen.getByText(t.tabOnly)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('sets the badge to 3, then clears it', async () => {
    render(<BadgeCheckSection />)
    expect(screen.getByText(t.supported)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.set }))
    expect(await screen.findByRole('status')).toHaveTextContent(t.didSet)
    expect(setAppBadge).toHaveBeenCalledWith(3)

    fireEvent.click(screen.getByRole('button', { name: t.clear }))
    expect(await screen.findByText(t.didClear)).toBeInTheDocument()
    expect(clearAppBadge).toHaveBeenCalledOnce()
  })

  it('reports a rejected call as the answer', async () => {
    setAppBadge.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    render(<BadgeCheckSection />)
    fireEvent.click(screen.getByRole('button', { name: t.set }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed('NotAllowedError: Denied'))
  })

  it('says so when the API is missing', async () => {
    delete nav.setAppBadge
    render(<BadgeCheckSection />)
    expect(screen.getByText(t.unsupported)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.set }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.unsupported)
  })
})
