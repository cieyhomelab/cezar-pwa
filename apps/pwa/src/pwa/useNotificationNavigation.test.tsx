import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import { NAVIGATE_MESSAGE } from './push-message.ts'
import { useNotificationNavigation } from './useNotificationNavigation.ts'

const container = new EventTarget() as EventTarget & { startMessages: () => void }
container.startMessages = vi.fn()

beforeEach(() => {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
})
afterEach(() => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

function Probe() {
  useNotificationNavigation()
  return <span data-testid="at">{useLocation().pathname}</span>
}

const post = (data: unknown) => act(() => void container.dispatchEvent(new MessageEvent('message', { data })))

describe('useNotificationNavigation', () => {
  it('routes the open window to the tapped task, in place (FR-041)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe />
      </MemoryRouter>,
    )
    expect(container.startMessages).toHaveBeenCalled()
    post({ type: NAVIGATE_MESSAGE, url: '/m/p/cezar-pwa/runs/a1b2' })
    expect(screen.getByTestId('at')).toHaveTextContent('/p/cezar-pwa/runs/a1b2')
  })

  it('ignores other messages and URLs outside the app', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Probe />
      </MemoryRouter>,
    )
    post({ type: 'SKIP_WAITING' })
    post({ type: NAVIGATE_MESSAGE, url: 'https://evil.example/m/p/x/runs/y' })
    post({ type: NAVIGATE_MESSAGE, url: '/api/v1/health' })
    post(null)
    expect(screen.getByTestId('at')).toHaveTextContent('/settings')
  })
})
