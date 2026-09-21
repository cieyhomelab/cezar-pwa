import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pl } from './i18n/pl.ts'
import { AppRoutes } from './routes.tsx'
import {
  emptyRunsIndexResponse,
  healthResponse,
  refusalResponse,
  renderWithQuery,
  routeFetch,
} from '../test/query.tsx'

// Every App render now probes the session (S-02), so each test has to say what
// Cezar answers. The chrome assertions use an authorized instance; the gate's
// own behaviour is covered in features/auth.
function renderApp(authorized = true) {
  routeFetch({
    '/api/v1/health': authorized ? () => healthResponse() : refusalResponse,
    '/api/v1/workspace/runs-index': authorized ? emptyRunsIndexResponse : refusalResponse,
  })
  return renderWithQuery(<AppRoutes />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App shell', () => {
  it('renders the app chrome', async () => {
    renderApp()
    expect(screen.getByRole('heading', { name: pl.app.name })).toBeInTheDocument()
    // Behind the gate: the task list (S-03), here with nothing waiting.
    expect(await screen.findByRole('heading', { name: pl.runs.summary.none })).toBeInTheDocument()
  })

  it('links back to the full cockpit at the origin root', () => {
    renderApp()
    expect(screen.getByRole('link', { name: pl.shell.openCockpit })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('shows no update prompt while no new worker is waiting', () => {
    renderApp()
    expect(screen.queryByText(pl.update.available)).not.toBeInTheDocument()
  })

  it('offers the install instruction while running in a browser tab (S-01)', () => {
    renderApp()
    expect(screen.getByText(pl.install.title)).toBeInTheDocument()
  })

  it('shows no offline banner while the network is up', () => {
    renderApp()
    expect(screen.queryByText(pl.offline.banner)).not.toBeInTheDocument()
  })

  it('keeps the chrome reachable when there is no session (S-02)', async () => {
    // The update prompt, the offline banner and the install hint all live
    // outside the gate: an operator whose session lapsed must still be able to
    // accept a new version or read that they are offline.
    renderApp(false)

    expect(await screen.findByRole('heading', { name: pl.auth.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: pl.app.name })).toBeInTheDocument()
    expect(screen.getByText(pl.install.title)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: pl.runs.summary.none })).not.toBeInTheDocument()
  })
})
