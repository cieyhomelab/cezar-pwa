import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import { pl } from './i18n/pl.ts'

describe('App shell', () => {
  it('renders the app chrome', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: pl.app.name })).toBeInTheDocument()
    expect(screen.getByText(pl.shell.empty)).toBeInTheDocument()
  })

  it('links back to the full cockpit at the origin root', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: pl.shell.openCockpit })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('shows no update prompt while no new worker is waiting', () => {
    render(<App />)
    expect(screen.queryByText(pl.update.available)).not.toBeInTheDocument()
  })

  it('offers the install instruction while running in a browser tab (S-01)', () => {
    render(<App />)
    expect(screen.getByText(pl.install.title)).toBeInTheDocument()
  })

  it('shows no offline banner while the network is up', () => {
    render(<App />)
    expect(screen.queryByText(pl.offline.banner)).not.toBeInTheDocument()
  })
})
