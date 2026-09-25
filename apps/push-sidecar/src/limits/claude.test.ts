import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_USAGE_URL, claudeAdapter, mapClaudeUsage } from './claude.ts'
import { fixture, fixturePath, FIXTURE_REFRESH, FIXTURE_TOKEN } from './testing.ts'
import type { LimitsAccount } from './types.ts'

const NOW = Date.parse('2026-09-25T10:00:00Z')

describe('mapClaudeUsage', () => {
  it('reads the 5-hour, weekly and per-model weekly windows', () => {
    expect(mapClaudeUsage(fixture('claude-usage.json'))).toEqual({
      status: 'ok',
      windows: [
        { kind: 'five_hour', usedPercent: 42, resetsAt: '2026-09-25T13:00:00.412Z' },
        { kind: 'weekly', usedPercent: 23, resetsAt: '2026-09-29T00:00:00.412Z' },
        { kind: 'weekly_model', model: 'opus', usedPercent: 61, resetsAt: '2026-09-29T00:00:00.412Z' },
      ],
    })
  })

  it('leaves out a window reported as null rather than calling it 0', () => {
    const reading = mapClaudeUsage({ five_hour: null, seven_day: { utilization: 5, resets_at: null } })
    expect(reading).toEqual({ status: 'ok', windows: [{ kind: 'weekly', usedPercent: 5 }] })
  })

  it('reports a shape it does not know', () => {
    expect(mapClaudeUsage(fixture('claude-drift.json'))).toMatchObject({ status: 'unavailable' })
    expect(mapClaudeUsage({ five_hour: { utilization: '42' } })).toMatchObject({ status: 'unavailable' })
    expect(mapClaudeUsage('nope')).toMatchObject({ status: 'unavailable' })
  })
})

describe('claudeAdapter', () => {
  let dir: string
  let account: LimitsAccount
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cezar-push-claude-'))
    await copyFile(fixturePath('claude-credentials.json'), join(dir, '.credentials.json'))
    account = { provider: 'claude', id: 'default', configDir: dir }
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const answering = (status: number, body: unknown) =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))

  it("sends the account's token to the usage endpoint and maps the answer", async () => {
    const fetch = answering(200, fixture('claude-usage.json'))
    const reading = await claudeAdapter({ fetch, now: () => NOW })(account)
    expect(reading).toEqual(mapClaudeUsage(fixture('claude-usage.json')))
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(CLAUDE_USAGE_URL)
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${FIXTURE_TOKEN}`)
  })

  it('reads the default account from the configured default dir', async () => {
    const fetch = answering(200, fixture('claude-usage.json'))
    const reading = await claudeAdapter({ fetch, now: () => NOW, defaultConfigDir: dir })({
      ...account,
      configDir: undefined,
    })
    expect(reading.status).toBe('ok')
  })

  it.each([
    [401, 'the Claude usage endpoint refused this login (HTTP 401)'],
    [403, 'the Claude usage endpoint refused this login (HTTP 403)'],
    [500, 'the Claude usage endpoint answered HTTP 500'],
  ])('reports HTTP %i without the token', async (status, reason) => {
    const fetch = answering(status, { error: { message: `invalid token ${FIXTURE_TOKEN}` } })
    expect(await claudeAdapter({ fetch, now: () => NOW })(account)).toEqual({ status: 'unavailable', reason })
  })

  it('reports drift, an unreachable endpoint and a non-JSON answer', async () => {
    const read = (fetch: typeof globalThis.fetch) => claudeAdapter({ fetch, now: () => NOW })(account)
    expect(await read(answering(200, fixture('claude-drift.json')))).toMatchObject({ status: 'unavailable' })
    expect(await read(vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))).toEqual({
      status: 'unavailable',
      reason: 'the Claude usage endpoint could not be reached',
    })
    expect(await read(vi.fn(async () => new Response('<html>')))).toEqual({
      status: 'unavailable',
      reason: 'the Claude usage endpoint did not answer JSON',
    })
  })

  it('never calls out without a usable login', async () => {
    const fetch = answering(200, fixture('claude-usage.json'))
    const read = () => claudeAdapter({ fetch, now: () => NOW })(account)

    await rm(join(dir, '.credentials.json'))
    expect(await read()).toEqual({ status: 'unavailable', reason: 'no Claude login found for this account' })

    await writeFile(join(dir, '.credentials.json'), `{"claudeAiOauth": {"accessToken": "${FIXTURE_TOKEN}"`)
    expect(await read()).toEqual({ status: 'unavailable', reason: 'the Claude credentials file is not readable JSON' })

    await writeFile(join(dir, '.credentials.json'), JSON.stringify({ apiKey: FIXTURE_TOKEN }))
    expect(await read()).toMatchObject({ status: 'unavailable' })

    await writeFile(
      join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: FIXTURE_TOKEN, refreshToken: FIXTURE_REFRESH, expiresAt: NOW } }),
    )
    expect(await read()).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('expired') })

    expect(fetch).not.toHaveBeenCalled()
  })
})
