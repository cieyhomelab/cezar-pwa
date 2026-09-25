import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexAdapter, mapCodexResult } from './codex.ts'
import { fixture, fixturePath } from './testing.ts'
import type { LimitsAccount } from './types.ts'

const account: LimitsAccount = { provider: 'codex', id: 'default', configDir: undefined }

describe('mapCodexResult', () => {
  it('reads both windows by their length', () => {
    expect(mapCodexResult(fixture('codex-both-windows.json'))).toEqual({
      status: 'ok',
      windows: [
        { kind: 'five_hour', usedPercent: 42, resetsAt: '2026-09-25T11:00:00.000Z' },
        { kind: 'weekly', usedPercent: 23, resetsAt: '2026-09-29T00:00:00.000Z' },
      ],
    })
  })

  it('leaves a missing 5-hour window out, even when the weekly one is `primary`', () => {
    expect(mapCodexResult(fixture('codex-no-five-hour.json'))).toEqual({
      status: 'ok',
      windows: [{ kind: 'weekly', usedPercent: 23, resetsAt: '2026-09-29T00:00:00.000Z' }],
    })
  })

  it.each([
    ['an unknown window length', { primary: { usedPercent: 5, windowDurationMins: 60, resetsAt: 1 } }, []],
    ['no length at all', { primary: { usedPercent: 5, resetsAt: 1 } }, []],
    [
      'no reset time',
      { primary: { usedPercent: 5, windowDurationMins: 300 } },
      [{ kind: 'five_hour', usedPercent: 5 }],
    ],
  ])('skips what it cannot place: %s', (_, rateLimits, windows) => {
    expect(mapCodexResult({ rateLimits })).toEqual({ status: 'ok', windows })
  })

  it('reports a login with no plan limits, and a shape it does not know', () => {
    expect(mapCodexResult({ rateLimits: null })).toMatchObject({ status: 'unavailable' })
    expect(mapCodexResult({ limits: [] })).toMatchObject({ status: 'unavailable' })
    expect(mapCodexResult({ rateLimits: { primary: { usedPercent: '42%' } } })).toMatchObject({
      status: 'unavailable',
    })
  })
})

/**
 * The adapter against a stand-in `codex` binary that speaks the app-server's line protocol, so
 * the spawn, the handshake and the kill are real.
 */
describe('codexAdapter', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cezar-push-codex-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  /** `mode`: `answer` replies with the fixture, `error` with an RPC error, `hang` never replies. */
  async function fakeCodex(mode: 'answer' | 'error' | 'hang', result?: string): Promise<string> {
    const file = join(dir, 'codex')
    // A temp dir may sit under a `"type": "module"` package; the stand-in is CommonJS either way.
    await writeFile(join(dir, 'package.json'), '{"type":"commonjs"}')
    await writeFile(
      file,
      `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs')
const { createInterface } = require('node:readline')
writeFileSync(${JSON.stringify(join(dir, 'pid'))}, String(process.pid))
writeFileSync(${JSON.stringify(join(dir, 'env'))}, process.env.CODEX_HOME ?? '')
const mode = ${JSON.stringify(mode)}
const say = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (mode === 'hang') return
  if (m.method === 'initialize') {
    say({ method: 'some/notification', params: {} })
    say({ id: m.id, result: { userAgent: 'fake' } })
  }
  if (m.method === 'account/rateLimits/read') {
    if (mode === 'error') say({ id: m.id, error: { code: -32600, message: 'not logged in' } })
    else say({ id: m.id, result: JSON.parse(readFileSync(${JSON.stringify(result ?? '')}, 'utf8')) })
  }
})
setInterval(() => {}, 1000)
`,
    )
    await chmod(file, 0o755)
    return file
  }

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  it('reads the windows through the app-server and leaves no child behind', async () => {
    const command = await fakeCodex('answer', fixturePath('codex-both-windows.json'))
    const reading = await codexAdapter({ command })(account)
    expect(reading).toEqual(mapCodexResult(fixture('codex-both-windows.json')))
    const pid = Number(await readFile(join(dir, 'pid'), 'utf8'))
    await expect.poll(() => alive(pid)).toBe(false)
  })

  it("points the app-server at a profile's own CODEX_HOME", async () => {
    const command = await fakeCodex('answer', fixturePath('codex-no-five-hour.json'))
    await codexAdapter({ command })({ ...account, id: 'work', configDir: '/home/op/.codex-work' })
    expect(await readFile(join(dir, 'env'), 'utf8')).toBe('/home/op/.codex-work')
  })

  it("passes codex's own refusal on", async () => {
    const command = await fakeCodex('error')
    expect(await codexAdapter({ command })(account)).toEqual({
      status: 'unavailable',
      reason: 'codex: not logged in',
    })
  })

  it('gives up on a silent app-server, and kills it', async () => {
    const command = await fakeCodex('hang')
    expect(await codexAdapter({ command, timeoutMs: 500 })(account)).toEqual({
      status: 'unavailable',
      reason: 'codex did not answer in time',
    })
    const pid = Number(await readFile(join(dir, 'pid'), 'utf8'))
    await expect.poll(() => alive(pid)).toBe(false)
  })

  it('says so when codex is not installed', async () => {
    expect(await codexAdapter({ command: join(dir, 'no-such-codex') })(account)).toEqual({
      status: 'unavailable',
      reason: 'codex not installed',
    })
  })
})
