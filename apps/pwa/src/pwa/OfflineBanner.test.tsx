import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { pl } from '../i18n/pl.ts'
import { OfflineBanner } from './OfflineBanner.tsx'

describe('OfflineBanner', () => {
  it('stays out of the way while the network is up', () => {
    render(<OfflineBanner online />)
    expect(screen.queryByText(pl.offline.banner)).not.toBeInTheDocument()
  })

  it('says plainly that there is no network (FR-002)', () => {
    render(<OfflineBanner online={false} />)
    expect(screen.getByText(pl.offline.banner)).toBeInTheDocument()
  })

  it('announces the state rather than relying on colour', () => {
    render(<OfflineBanner online={false} />)
    expect(screen.getByRole('status')).toHaveTextContent(pl.offline.banner)
  })
})
