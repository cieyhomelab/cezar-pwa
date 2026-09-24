import type { ApiRun, QueuedMessage } from '@cezar-pwa/cezar-contract/contract'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveRun from '../../../test/fixtures/run.live-0.11.0.json'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'

/**
 * #65 on the task screen: a transcript `image` line and a queued message's attached image load
 * from the project-scoped route (the recorded unscoped URL is a 404 on the live host), open
 * full-screen on a tap, and fall back to the file-name line when the image does not load.
 */

const BASE_RUN = liveRun as unknown as ApiRun
const BASE = `/api/v1/p/cezar-pwa/runs/${BASE_RUN.id}`
const t = en.run.transcript.images

const imageLine = (seq: number, url: string, name?: string) => ({
  seq,
  ts: '2026-09-24T08:00:00.000Z',
  type: 'image',
  stepId: 'task',
  url,
  ...(name !== undefined ? { name } : {}),
})

function serve(opts: { events?: unknown[]; status?: string; stack?: QueuedMessage[] } = {}) {
  const run = () =>
    ({
      ...BASE_RUN,
      status: opts.status ?? 'running',
      steps: [],
      currentStepId: undefined,
      queuedMessages: opts.stack ?? [],
    }) as ApiRun
  const events = opts.events ?? []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/v1/health') return jsonResponse({ version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] })
    if (path === '/api/v1/workspace/runs-index') return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
    if (path === BASE) return jsonResponse(run())
    if (path === `${BASE}/history`)
      return jsonResponse({ events, itemCount: events.length, liveCursor: 'live', asOfSeq: events.length, hasOlder: false })
    if (path === `${BASE}/history-context`) return jsonResponse({ contextEvents: [], asOfSeq: 0 })
    if (path === `${BASE}/read`) return jsonResponse(run())
    throw new Error(`unrouted fetch in test: ${path}`)
  })
  renderWithQuery(<AppRoutes />, undefined, `/p/cezar-pwa/runs/${BASE_RUN.id}`)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RunScreen — transcript images (#65)', () => {
  it('shows a thumbnail read from the project-scoped route', async () => {
    serve({ events: [imageLine(1, `/api/v1/runs/${BASE_RUN.id}/images/2.png`, 'screenshot.png')] })
    const open = await screen.findByRole('button', { name: t.open('screenshot.png') })
    const img = within(open).getByRole('img', { name: 'screenshot.png' })
    expect(img.getAttribute('src')).toBe(`${BASE}/images/2.png`)
  })

  it('opens full screen on a tap and closes again', async () => {
    serve({ events: [imageLine(1, `/api/v1/runs/${BASE_RUN.id}/images/2.png`, 'screenshot.png')] })
    fireEvent.click(await screen.findByRole('button', { name: t.open('screenshot.png') }))
    const dialog = screen.getByRole('dialog', { name: 'screenshot.png' })
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe(`${BASE}/images/2.png`)
    fireEvent.click(within(dialog).getByRole('button', { name: t.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the full-screen view on Escape', async () => {
    serve({ events: [imageLine(1, `/api/v1/runs/${BASE_RUN.id}/images/2.png`, 'screenshot.png')] })
    fireEvent.click(await screen.findByRole('button', { name: t.open('screenshot.png') }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('falls back to the file-name line when the image fails to load', async () => {
    serve({ events: [imageLine(1, `/api/v1/runs/${BASE_RUN.id}/images/2.png`, 'screenshot.png')] })
    const open = await screen.findByRole('button', { name: t.open('screenshot.png') })
    fireEvent.error(within(open).getByRole('img'))
    expect(await screen.findByText(en.run.transcript.image('screenshot.png'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: t.open('screenshot.png') })).toBeNull()
  })

  it('keeps the text line for a recorded URL without a plain file name', async () => {
    serve({ events: [imageLine(1, `/api/v1/runs/${BASE_RUN.id}/images/..`, 'x.png')] })
    expect(await screen.findByText(en.run.transcript.image('x.png'))).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('RunScreen — queued message attachments (#65)', () => {
  it('shows an attached image from the scoped route and names a file', async () => {
    serve({
      status: 'queued',
      stack: [
        {
          id: 'q1',
          text: 'See the screenshot.',
          images: [`/api/v1/runs/${BASE_RUN.id}/images/pasted-1.png`, `/api/v1/runs/${BASE_RUN.id}/images/pasted-2.pdf`],
          createdAt: '2026-09-24T08:00:00.000Z',
        },
      ],
    })
    fireEvent.click(await screen.findByText(en.run.compose.queuedTitle(1)))
    const open = await screen.findByRole('button', { name: t.open('pasted-1.png') })
    expect(within(open).getByRole('img').getAttribute('src')).toBe(`${BASE}/images/pasted-1.png`)
    expect(screen.getByText(en.run.compose.queue.attachment('pasted-2.pdf'))).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
  })
})
