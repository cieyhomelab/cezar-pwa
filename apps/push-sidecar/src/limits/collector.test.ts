import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claudeAdapter, CLAUDE_USAGE_URL } from './claude.ts'
import { codexAdapter } from './codex.ts'
import { AGENT_PROFILES_PATH, LimitsCollector, type CollectorOptions, type ProviderSetting } from './collector.ts'
import { fixture, fixturePath, FIXTURE_REFRESH, FIXTURE_TOKEN } from './testing.ts'
import type { LimitsAdapter, LimitsReading } from './types.ts'

const CEZAR = 'http://127.0.0.1:4322'
const T0 = new Date('2026-09-25T10:00:00Z')
const INTERVAL = 5 * 60_000

const profilesResponse = (profiles: unknown[]) => ({
  editable: true,
  profiles,
  profileCapableProviders: ['claude', 'codex'],
  selections: {},
  defaults: {},
})

const profile = (id: string, provider: string, path: string, isDefault = false) => ({
  id,
  provider,
  label: id,
  configDir: path,
  path,
  exists: true,
  looksValid: true,
  isDefault,
  files: [],
})

const ok: LimitsReading = { status: 'ok', windows: [{ kind: 'weekly', usedPercent: 23 }] }
const off: ProviderSetting = { disabled: 'off in the sidecar config (LIMITS_CODEX)' }

function setup(options: {
  profiles?: unknown
  claude?: ProviderSetting
  codex?: ProviderSetting
  fetch?: typeof fetch
  onPoll?: CollectorOptions['onPoll']
}) {
  let now = T0
  const log = vi.fn<(message: string) => void>()
  const cezarFetch = vi.fn<typeof fetch>(async (input) => {
    if (String(input) === `${CEZAR}${AGENT_PROFILES_PATH}`) {
      if (options.profiles === undefined) return new Response('down', { status: 502 })
      return Response.json(options.profiles)
    }
    return new Response('not found', { status: 404 })
  })
  const collector = new LimitsCollector({
    cezarUrl: CEZAR,
    intervalMs: INTERVAL,
    fetch: options.fetch ?? cezarFetch,
    log,
    now: () => now,
    ...(options.onPoll ? { onPoll: options.onPoll } : {}),
    providers: {
      claude: options.claude ?? { disabled: 'off in the sidecar config (LIMITS_CLAUDE)' },
      codex: options.codex ?? off,
    },
  })
  return { collector, log, advance: (ms: number) => (now = new Date(now.getTime() + ms)) }
}

describe('LimitsCollector', () => {
  it('hands each finished pass to the after-poll hook (#94)', async () => {
    const onPoll = vi.fn()
    const { collector } = setup({ profiles: profilesResponse([]), codex: { adapter: async () => ok }, onPoll })
    await collector.pollOnce()
    expect(onPoll).toHaveBeenCalledWith(collector.snapshot().providers)
  })

  it('survives an after-poll hook that fails', async () => {
    const { collector, log } = setup({
      profiles: profilesResponse([]),
      onPoll: () => Promise.reject(new Error('boom')),
    })
    await collector.pollOnce()
    expect(collector.snapshot().observedAt).toBe(T0.toISOString())
    expect(log).toHaveBeenCalledWith('limits: the after-poll hook failed')
  })

  it('serves nothing until the first pass has run', () => {
    expect(setup({}).collector.snapshot()).toEqual({ observedAt: null, providers: [] })
  })

  it('reads one default account per provider when Cezar lists no profiles', async () => {
    const codex = vi.fn<LimitsAdapter>(async () => ok)
    const { collector } = setup({ profiles: profilesResponse([]), codex: { adapter: codex } })
    await collector.pollOnce()
    expect(collector.snapshot()).toEqual({
      observedAt: T0.toISOString(),
      providers: [
        {
          provider: 'claude',
          account: 'default',
          status: 'unavailable',
          reason: 'off in the sidecar config (LIMITS_CLAUDE)',
          observedAt: T0.toISOString(),
          windows: [],
        },
        { provider: 'codex', account: 'default', status: 'ok', observedAt: T0.toISOString(), windows: ok.windows },
      ],
    })
    expect(codex).toHaveBeenCalledWith({ provider: 'codex', id: 'default', configDir: undefined })
  })

  it("reads every profile of a provider from its own config dir", async () => {
    const codex = vi.fn<LimitsAdapter>(async () => ok)
    const { collector } = setup({
      profiles: profilesResponse([
        profile('default', 'codex', '/home/op/.codex', true),
        profile('work', 'codex', '/home/op/.codex-work'),
        profile('default', 'claude', '/home/op/.claude', true),
      ]),
      codex: { adapter: codex },
    })
    await collector.pollOnce()
    expect(collector.snapshot().providers.map((row) => `${row.provider}/${row.account}`)).toEqual([
      'claude/default',
      'codex/default',
      'codex/work',
    ])
    expect(codex.mock.calls.map(([account]) => account.configDir)).toEqual(['/home/op/.codex', '/home/op/.codex-work'])
  })

  it('falls back to the default accounts when Cezar cannot be read, and says so once', async () => {
    const { collector, log } = setup({ codex: { adapter: async () => ok } })
    await collector.pollOnce()
    await collector.pollOnce()
    expect(collector.snapshot().providers.map((row) => row.account)).toEqual(['default', 'default'])
    expect(log.mock.calls.filter(([m]) => m.includes('agent profiles'))).toEqual([
      ['limits: agent profiles unreadable (HTTP 502), reading default accounts'],
    ])
  })

  it('never serves the last good reading once the adapter fails', async () => {
    let reading: LimitsReading = ok
    const { collector, advance } = setup({ profiles: profilesResponse([]), codex: { adapter: async () => reading } })
    await collector.pollOnce()
    reading = { status: 'unavailable', reason: 'codex did not answer in time' }
    advance(INTERVAL)
    await collector.pollOnce()
    expect(collector.snapshot().providers[1]).toEqual({
      provider: 'codex',
      account: 'default',
      status: 'unavailable',
      reason: 'codex did not answer in time',
      observedAt: new Date(T0.getTime() + INTERVAL).toISOString(),
      windows: [],
    })
  })

  it('turns an adapter that throws into an unavailable row that does not quote the error', async () => {
    const { collector } = setup({
      profiles: profilesResponse([]),
      codex: { adapter: async () => Promise.reject(new Error(`boom ${FIXTURE_TOKEN}`)) },
    })
    await collector.pollOnce()
    expect(collector.snapshot().providers[1]).toMatchObject({
      status: 'unavailable',
      reason: 'the limits read failed unexpectedly',
    })
  })

  it('stops calling a reading current when the loop has not refreshed it', async () => {
    const { collector, advance } = setup({ profiles: profilesResponse([]), codex: { adapter: async () => ok } })
    await collector.pollOnce()
    advance(3 * INTERVAL)
    expect(collector.snapshot().providers[1]).toMatchObject({ status: 'ok' })
    advance(1)
    expect(collector.snapshot().providers[1]).toMatchObject({
      status: 'unavailable',
      observedAt: T0.toISOString(),
      windows: [],
    })
  })

  it('logs a row only when its status changes', async () => {
    let reading: LimitsReading = ok
    const { collector, log } = setup({ profiles: profilesResponse([]), codex: { adapter: async () => reading } })
    await collector.pollOnce()
    await collector.pollOnce()
    reading = { status: 'unavailable', reason: 'codex not installed' }
    await collector.pollOnce()
    expect(log.mock.calls.map(([m]) => m)).toEqual([
      'limits: claude/default unavailable (off in the sidecar config (LIMITS_CLAUDE))',
      'limits: codex/default ok',
      'limits: codex/default unavailable (codex not installed)',
    ])
  })

  it('stops between passes', async () => {
    const { collector } = setup({ profiles: profilesResponse([]) })
    const running = collector.run()
    await vi.waitFor(() => expect(collector.snapshot().observedAt).not.toBeNull())
    collector.stop()
    await running
  })
})

/**
 * The credential never leaves the adapter: not in the served JSON, not in a log line — whether the
 * read succeeds or the endpoint echoes the token back in its error.
 */
describe('the Claude token', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cezar-push-token-'))
    await copyFile(fixturePath('claude-credentials.json'), join(dir, '.credentials.json'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it.each([
    ['a good read', 200, fixture('claude-usage.json')],
    ['a 401 that echoes it', 401, { error: { message: `bad token ${FIXTURE_TOKEN}` } }],
    ['shape drift', 200, { token: FIXTURE_TOKEN }],
  ])('appears in no response and no log after %s', async (_, status, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input) === CLAUDE_USAGE_URL) return Response.json(body, { status })
      return Response.json(profilesResponse([profile('default', 'claude', dir, true)]))
    })
    const consoleSpy = vi.spyOn(console, 'log')
    const errorSpy = vi.spyOn(console, 'error')
    const { collector, log } = setup({
      fetch,
      claude: { adapter: claudeAdapter({ fetch, now: () => T0.getTime() }) },
      codex: { adapter: codexAdapter({ command: join(dir, 'no-such-codex') }) },
    })
    await collector.pollOnce()

    const served = JSON.stringify(collector.snapshot())
    const logged = JSON.stringify([log.mock.calls, consoleSpy.mock.calls, errorSpy.mock.calls])
    consoleSpy.mockRestore()
    errorSpy.mockRestore()
    for (const secret of [FIXTURE_TOKEN, FIXTURE_REFRESH]) {
      expect(served).not.toContain(secret)
      expect(logged).not.toContain(secret)
    }
    expect(served).toContain('"provider":"claude"')
  })
})
