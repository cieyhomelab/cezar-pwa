import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en.ts'
import { UpdatePrompt } from './UpdatePrompt.tsx'

const noop = () => {}

describe('UpdatePrompt', () => {
  it('stays hidden while no new worker is waiting', () => {
    render(<UpdatePrompt needRefresh={false} onDismiss={noop} onUpdate={noop} />)
    expect(screen.queryByText(en.update.available)).not.toBeInTheDocument()
  })

  it('offers the new version instead of applying it (FR-003)', () => {
    const onUpdate = vi.fn()
    render(<UpdatePrompt needRefresh onDismiss={noop} onUpdate={onUpdate} />)

    expect(screen.getByText(en.update.available)).toBeInTheDocument()
    // Nothing happens until the operator says so — the whole point of the
    // requirement is that the app never swaps mid-use.
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('applies the update only on the explicit action', () => {
    const onUpdate = vi.fn()
    render(<UpdatePrompt needRefresh onDismiss={noop} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: en.update.action }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('lets the operator defer without updating', () => {
    const onDismiss = vi.fn()
    const onUpdate = vi.fn()
    render(<UpdatePrompt needRefresh onDismiss={onDismiss} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: en.update.dismiss }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('keeps both controls at the 44px touch minimum', () => {
    render(<UpdatePrompt needRefresh onDismiss={noop} onUpdate={noop} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('touch-target')
    }
  })
})
