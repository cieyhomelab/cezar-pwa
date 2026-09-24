import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../i18n/en.ts'
import { BadgeCheckSection } from './BadgeCheckSection.tsx'

/** #68: the temporary on-device badge check. The badge itself is the device's to show. */

const t = en.settings.badge
const nav = window.navigator

/** jsdom has no badge API: each test defines it, and takes it away again. */
function define(key: 'standalone' | 'setAppBadge' | 'clearAppBadge', value: unknown) {
  Object.defineProperty(nav, key, { configurable: true, value })
}
const remove = (key: string) => Reflect.deleteProperty(nav, key)

let setAppBadge: ReturnType<typeof vi.fn>
let clearAppBadge: ReturnType<typeof vi.fn>

beforeEach(() => {
  setAppBadge = vi.fn(async () => {})
  clearAppBadge = vi.fn(async () => {})
  define('standalone', true)
  define('setAppBadge', setAppBadge)
  define('clearAppBadge', clearAppBadge)
})

afterEach(() => {
  remove('standalone')
  remove('setAppBadge')
  remove('clearAppBadge')
})

describe('BadgeCheckSection', () => {
  it('in a browser tab, only says to open the installed app', () => {
    remove('standalone')
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
    remove('setAppBadge')
    render(<BadgeCheckSection />)
    expect(screen.getByText(t.unsupported)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.set }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.unsupported)
  })
})
