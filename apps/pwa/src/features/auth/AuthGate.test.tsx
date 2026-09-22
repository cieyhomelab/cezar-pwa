import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pl } from '../../i18n/pl.ts'
import {
  healthResponse,
  refusalResponse,
  renderWithQuery,
  stubFetch,
} from '../../../test/query.tsx'
import { AuthGate } from './AuthGate.tsx'
import { resetUnlockOutcome } from './unlock.ts'

const TASKS = 'lista zadań'

function renderGate() {
  return renderWithQuery(
    <AuthGate>
      <p>{TASKS}</p>
    </AuthGate>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  resetUnlockOutcome()
})

describe('AuthGate', () => {
  it('says it is checking before the probe answers', () => {
    stubFetch(() => new Promise<Response>(() => {}))
    renderGate()
    expect(screen.getByRole('status')).toHaveTextContent(pl.auth.checking)
    expect(screen.queryByText(TASKS)).not.toBeInTheDocument()
  })

  it('shows "Connect to Cezar" — not an error, not an empty list — when the gateway refuses (FR-004)', async () => {
    stubFetch(refusalResponse)
    renderGate()

    expect(
      await screen.findByRole('heading', { name: pl.auth.title }),
    ).toBeInTheDocument()
    expect(screen.queryByText(TASKS)).not.toBeInTheDocument()
  })

  it('renders what it guards once there is a session', async () => {
    stubFetch(healthResponse)
    renderGate()

    expect(await screen.findByText(TASKS)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: pl.auth.title })).not.toBeInTheDocument()
  })

  it('tells a dead network apart from a refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    renderGate()

    expect(
      await screen.findByRole('heading', { name: pl.auth.unreachable.title }),
    ).toBeInTheDocument()
    // The operator is not sent hunting for an access link they already have.
    expect(screen.queryByLabelText(pl.auth.linkLabel)).not.toBeInTheDocument()
  })

  it('re-probes on demand and lets the operator through once Cezar answers', async () => {
    let authorized = false
    stubFetch(() => (authorized ? healthResponse() : refusalResponse()))
    renderGate()
    await screen.findByRole('heading', { name: pl.auth.title })

    authorized = true
    fireEvent.click(screen.getByRole('button', { name: pl.auth.recheck }))

    expect(await screen.findByText(TASKS)).toBeInTheDocument()
  })

  it('re-probes when the app comes back to the foreground, with nothing pressed', async () => {
    // The session changed while the app was frozen — it expired, or (in a
    // browser tab) the operator opened the access link and switched back. The
    // only trigger available is the visibility change (CLAUDE.md → "Specyfika iOS").
    let authorized = false
    stubFetch(() => (authorized ? healthResponse() : refusalResponse()))
    renderGate()
    await screen.findByRole('heading', { name: pl.auth.title })

    authorized = true
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => expect(screen.getByText(TASKS)).toBeInTheDocument())
  })

  describe('once a session has been confirmed', () => {
    const DRAFT = 'odpowiedź w trakcie pisania'

    function renderGateWithDraft() {
      return renderWithQuery(
        <AuthGate>
          <label>
            {TASKS}
            <input />
          </label>
        </AuthGate>,
      )
    }

    it('keeps what it guards mounted — and the typed reply — when a re-probe hits a dead network', async () => {
      // The phone wakes before its radio does: the visibility re-probe fails.
      let online = true
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        if (online) return healthResponse()
        throw new TypeError('Failed to fetch')
      })
      const { client } = renderGateWithDraft()
      const input = await screen.findByLabelText(TASKS)
      fireEvent.change(input, { target: { value: DRAFT } })

      online = false
      document.dispatchEvent(new Event('visibilitychange'))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(client.getQueryCache().getAll()[0]?.state.status).toBe('error'),
      )

      expect(
        screen.queryByRole('heading', { name: pl.auth.unreachable.title }),
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText(TASKS)).toBe(input)
      expect(input).toHaveValue(DRAFT)
    })

    it('still offers "Connect to Cezar" when a re-probe is refused', async () => {
      let authorized = true
      stubFetch(() => (authorized ? healthResponse() : refusalResponse()))
      renderGateWithDraft()
      await screen.findByLabelText(TASKS)

      authorized = false
      document.dispatchEvent(new Event('visibilitychange'))

      expect(
        await screen.findByRole('heading', { name: pl.auth.title }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText(TASKS)).not.toBeInTheDocument()
    })
  })
})
