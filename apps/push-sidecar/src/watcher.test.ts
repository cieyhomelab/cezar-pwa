import type { PushPayload } from '@cezar-pwa/shared'
import { describe, expect, it, vi } from 'vitest'
import { Watcher } from './watcher.ts'

const CEZAR = 'http://127.0.0.1:4322'

const index = (runs: { projectId: string; id: string; status: string }[]) => ({
  runs: runs.map((run) => ({ title: 'x', createdAt: '2026-09-21T00:00:00Z', ...run })),
  perProjectLimit: 200,
  truncated: [],
  referenceStatuses: {},
})
const health = { version: '0.11.0', projects: [{ id: 'cezar-pwa', name: 'Cezar PWA' }] }

const runFrame = (over: Record<string, unknown>) => ({
  type: 'run',
  data: JSON.stringify({
    project: 'cezar-pwa',
    id: 'r1',
    title: 'Add the settings screen',
    createdAt: '2026-09-21T00:00:00Z',
    status: 'running',
    ...over,
  }),
})

/** A watcher with its baseline already in place. */
async function seeded(runs: Parameters<typeof index>[0]) {
  const notify = vi.fn<(payload: PushPayload) => void>()
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname
    if (path === '/api/v1/workspace/runs-index') return Response.json(index(runs))
    if (path === '/api/v1/health') return Response.json(health)
    return new Response('', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  const watcher = new Watcher({ cezarUrl: CEZAR, notify, fetch })
  await watcher.seed()
  return { watcher, notify }
}

describe('Watcher.handleFrame', () => {
  it('notifies a run entering a state that needs the operator, with project name and reason', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }])
    watcher.handleFrame(runFrame({ status: 'waiting', titleSummary: 'Settings screen' }))
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      kind: 'attention',
      projectId: 'cezar-pwa',
      projectName: 'Cezar PWA',
      runId: 'r1',
      title: 'Settings screen',
      reason: 'needs you',
    })
  })

  it('does not re-announce what the baseline already had (a reconnect is not news)', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'cezar-pwa', id: 'r1', status: 'waiting' }])
    watcher.handleFrame(runFrame({ status: 'waiting' }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('is silent on a run it has never seen, and on a running task re-sending its record', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }])
    watcher.handleFrame(runFrame({ id: 'new', status: 'failed' }))
    watcher.handleFrame(runFrame({ status: 'running' }))
    watcher.handleFrame(runFrame({ status: 'running' }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('announces each new entry once, and a later change of reason again', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }])
    watcher.handleFrame(runFrame({ status: 'waiting' }))
    watcher.handleFrame(runFrame({ status: 'waiting' }))
    watcher.handleFrame(runFrame({ status: 'failed' }))
    expect(notify.mock.calls.map(([payload]) => payload.reason)).toEqual(['needs you', 'failed'])
  })

  it('keys by project: the same run id in another project is another task', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'kai-phone', id: 'r1', status: 'running' }])
    watcher.handleFrame(runFrame({ status: 'waiting' }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('falls back to the project id when the name is unknown', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'kai-phone', id: 'r1', status: 'running' }])
    watcher.handleFrame(runFrame({ project: 'kai-phone', status: 'review' }))
    expect(notify.mock.calls[0]?.[0].projectName).toBe('kai-phone')
  })

  it('forgets a deleted run, so its id coming back is first sight', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }])
    watcher.handleFrame({ type: 'run-deleted', data: JSON.stringify({ project: 'cezar-pwa', id: 'r1' }) })
    expect(watcher.statuses.size).toBe(0)
    watcher.handleFrame(runFrame({ status: 'waiting' }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('updates the baseline without notifying when told to be silent', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }])
    watcher.handleFrame(runFrame({ status: 'waiting' }), { silent: true })
    expect(notify).not.toHaveBeenCalled()
    expect(watcher.statuses.get('cezar-pwa/r1')).toBe('waiting')
  })

  it('ignores frames it cannot read and types it does not know (rule 5)', async () => {
    const { watcher, notify } = await seeded([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }])
    watcher.handleFrame({ type: 'run', data: '{ not json' })
    watcher.handleFrame({ type: 'run', data: JSON.stringify({ id: 'r1', status: 'waiting' }) })
    watcher.handleFrame({ type: 'something-new', data: '{}' })
    watcher.handleFrame({ type: 'ping', data: '' })
    expect(notify).not.toHaveBeenCalled()
    expect(watcher.statuses.get('cezar-pwa/r1')).toBe('running')
  })
})

describe('Watcher.seed', () => {
  it('replaces the baseline wholesale, so runs gone from the index fall out', async () => {
    const { watcher } = await seeded([{ projectId: 'cezar-pwa', id: 'old', status: 'waiting' }])
    const fetch = vi.fn(async (url: string | URL | Request) =>
      new URL(String(url)).pathname === '/api/v1/health'
        ? Response.json(health)
        : Response.json(index([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }])),
    ) as unknown as typeof globalThis.fetch
    const fresh = new Watcher({ cezarUrl: CEZAR, notify: vi.fn(), fetch })
    watcher.statuses.forEach((status, key) => fresh.statuses.set(key, status))
    await fresh.seed()
    expect([...fresh.statuses.keys()]).toEqual(['cezar-pwa/r1'])
  })

  it('refuses an index in an unknown shape rather than seeding nothing', async () => {
    const fetch = vi.fn(async () => Response.json({ nope: true })) as unknown as typeof globalThis.fetch
    await expect(new Watcher({ cezarUrl: CEZAR, notify: vi.fn(), fetch }).seed()).rejects.toThrow('unknown shape')
  })
})

describe('Watcher.connectOnce', () => {
  /** A stream that sends `chunks` and then stays open until aborted. */
  function stream(chunks: string[]) {
    return (signal: AbortSignal) =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
            signal.addEventListener('abort', () => controller.error(signal.reason))
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
  }

  it('seeds on open, holds early frames silently, then notifies on a later transition', async () => {
    let release: () => void = () => {}
    const indexHeld = new Promise<void>((resolve) => {
      release = resolve
    })
    const notify = vi.fn()
    let later: ReadableStreamDefaultController<Uint8Array> | undefined
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (path === '/api/v1/workspace/events') {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              later = controller
              // Arrives before the baseline: applied to it, never announced.
              controller.enqueue(new TextEncoder().encode(`event: run\ndata: ${runFrame({ status: 'waiting' }).data}\n\n`))
              init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      if (path === '/api/v1/workspace/runs-index') {
        await indexHeld
        return Response.json(index([{ projectId: 'cezar-pwa', id: 'r1', status: 'running' }]))
      }
      return Response.json(health)
    }) as unknown as typeof globalThis.fetch

    const watcher = new Watcher({ cezarUrl: CEZAR, notify, fetch })
    const connection = watcher.connectOnce()
    await vi.waitFor(() => expect(watcher.state).toBe('live'))
    release()
    await vi.waitFor(() => expect(watcher.seededAt).toBeDefined())
    await vi.waitFor(() => expect(watcher.statuses.get('cezar-pwa/r1')).toBe('waiting'))
    expect(notify).not.toHaveBeenCalled()

    later?.enqueue(new TextEncoder().encode(`event: run\ndata: ${runFrame({ status: 'review' }).data}\n\n`))
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce())
    expect(notify.mock.calls[0]?.[0].reason).toBe('needs review')

    watcher.stop()
    expect(await connection).toBe(true)
  })

  it('drops a stream that goes quiet past the watchdog', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      new URL(String(url)).pathname === '/api/v1/workspace/events'
        ? stream([])(init!.signal!)
        : Response.json(index([])),
    ) as unknown as typeof globalThis.fetch
    const log = vi.fn()
    const watcher = new Watcher({ cezarUrl: CEZAR, notify: vi.fn(), fetch, log, watchdogMs: 30 })
    expect(await watcher.connectOnce()).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('watchdog'))
  })

  it('does not count a stream whose baseline fails as opened, so the backoff grows', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      new URL(String(url)).pathname === '/api/v1/workspace/events'
        ? stream([])(init!.signal!)
        : new Response('down', { status: 500 }),
    ) as unknown as typeof globalThis.fetch
    const log = vi.fn()
    const watcher = new Watcher({ cezarUrl: CEZAR, notify: vi.fn(), fetch, log })
    expect(await watcher.connectOnce()).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('baseline failed'))
  })

  it('reports a refused connection as not opened, so the backoff grows', async () => {
    const fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof globalThis.fetch
    const watcher = new Watcher({ cezarUrl: CEZAR, notify: vi.fn(), fetch, log: () => {} })
    expect(await watcher.connectOnce()).toBe(false)
  })
})

describe('Watcher.run', () => {
  it('reconnects after a drop and stops when told', async () => {
    let connects = 0
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (new URL(String(url)).pathname === '/api/v1/workspace/events') {
        connects += 1
        return new Response('', { status: 502 })
      }
      return Response.json(index([]))
    }) as unknown as typeof globalThis.fetch
    const watcher = new Watcher({ cezarUrl: CEZAR, notify: vi.fn(), fetch, log: () => {}, backoffMs: [1] })
    const running = watcher.run()
    await vi.waitFor(() => expect(connects).toBeGreaterThanOrEqual(3))
    watcher.stop()
    await running
    expect(watcher.state).toBe('stopped')
  })
})
