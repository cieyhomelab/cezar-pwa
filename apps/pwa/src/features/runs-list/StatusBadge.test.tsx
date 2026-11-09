import { deriveAttention, type AttentionInput } from '@cezar-pwa/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../../i18n/en.ts'
import { StatusBadge } from './StatusBadge.tsx'

const badge = (run: AttentionInput) => {
  render(<StatusBadge attention={deriveAttention(run)} status={run.status} />)
  return screen.getByText(en.runs.status[deriveAttention(run).label]!)
}

describe('StatusBadge — Cezar 0.19.0 states', () => {
  it('paints an idle-closed run in the idle tone, not as a failure', () => {
    const element = badge({ status: 'failed', idleClosedAt: '2026-11-04T10:00:00.000Z' })
    expect(element).toHaveTextContent('closed (idle)')
    expect(element).toHaveClass('text-idle')
    expect(element).not.toHaveClass('text-danger')
    expect(element.querySelector('[aria-hidden]')).not.toHaveClass('motion-safe:animate-pulse')
  })

  it('says a queued run is switching agent, pulsing', () => {
    const element = badge({ status: 'queued', fallbackEpisode: { pending: true } })
    expect(element).toHaveTextContent('switching agent')
    expect(element).toHaveClass('text-violet')
    expect(element.querySelector('[aria-hidden]')).toHaveClass('motion-safe:animate-pulse')
  })
})
