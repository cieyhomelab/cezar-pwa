import type { ApiRun, RunsIndexResponse } from '@cezar-pwa/cezar-contract/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, jsonResponse, stubFetch } from '../../test/query.tsx'
import { ApiError } from './http.ts'
import {
  applyReadReceipt,
  fetchHistory,
  fetchHistoryContext,
  fetchRun,
  markRunRead,
  runQueryKey,
} from './run.ts'
import { RUNS_INDEX_QUERY_KEY } from './runs-index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const requested = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}`)

describe('run reads', () => {
  it('always go through the project-scoped v1 routes, ids encoded (rule 2)', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ id: 'r', status: 'done', events: [], contextEvents: [] }))
    await fetchRun('my project', 'r/1')
    await fetchHistory('my project', 'r/1')
    await fetchHistoryContext('my project', 'r/1')
    await markRunRead('my project', 'r/1')
    expect(requested(fetchMock)).toEqual([
      'GET /api/v1/p/my%20project/runs/r%2F1',
      'GET /api/v1/p/my%20project/runs/r%2F1/history',
      'GET /api/v1/p/my%20project/runs/r%2F1/history-context',
      'POST /api/v1/p/my%20project/runs/r%2F1/read',
    ])
  })

  it('reject a record or page without the container the screen needs', async () => {
    stubFetch(() => jsonResponse({ nothing: true }))
    await expect(fetchRun('p', 'r')).rejects.toBeInstanceOf(ApiError)
    await expect(fetchHistory('p', 'r')).rejects.toBeInstanceOf(ApiError)
    await expect(fetchHistoryContext('p', 'r')).rejects.toBeInstanceOf(ApiError)
  })

  it('keep only lines with the event envelope, and read hasOlder strictly', async () => {
    stubFetch(() =>
      jsonResponse({
        events: [{ seq: 1, ts: 't', type: 'note' }, { seq: 'x', type: 'note' }, null, { seq: 2, ts: 't' }],
        itemCount: 1,
        liveCursor: 'c',
        asOfSeq: 2,
        hasOlder: 'yes',
      }),
    )
    const page = await fetchHistory('p', 'r')
    expect(page.events).toEqual([{ seq: 1, ts: 't', type: 'note' }])
    expect(page.hasOlder).toBe(false)
  })
})

describe('applyReadReceipt', () => {
  it('writes only seenAt, to the record and to the index row', () => {
    const client = createTestQueryClient()
    const run = { id: 'r', title: 'fresh', status: 'done' } as ApiRun
    client.setQueryData(runQueryKey('p', 'r'), run)
    client.setQueryData<RunsIndexResponse>(RUNS_INDEX_QUERY_KEY, {
      runs: [
        { projectId: 'p', id: 'r', title: 'fresh' },
        { projectId: 'q', id: 'r', title: 'other project, same id' },
      ] as RunsIndexResponse['runs'],
      referenceStatuses: {},
      perProjectLimit: 200,
      truncated: [],
    })
    applyReadReceipt(client, 'p', 'r', { title: 'stale', seenAt: 'now' } as ApiRun)
    expect(client.getQueryData(runQueryKey('p', 'r'))).toEqual({ ...run, seenAt: 'now' })
    const rows = client.getQueryData<RunsIndexResponse>(RUNS_INDEX_QUERY_KEY)?.runs
    expect(rows?.map((row) => [row.title, row.seenAt])).toEqual([
      ['fresh', 'now'],
      ['other project, same id', undefined],
    ])
  })

  it('does nothing with an answer that carries no receipt', () => {
    const client = createTestQueryClient()
    client.setQueryData(runQueryKey('p', 'r'), { id: 'r' })
    applyReadReceipt(client, 'p', 'r', {})
    expect(client.getQueryData(runQueryKey('p', 'r'))).toEqual({ id: 'r' })
  })
})
