import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_DEDUP_MS, GateAlerts, initGateToken, tokenMatches, type GateBody } from './gate.ts'

const BODY: GateBody = { gate: 'spec', repo: 'o/r', number: 3, title: 'Spec', url: 'https://github.com/o/r/pull/3' }

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gate-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('initGateToken', () => {
  it('creates 32 random bytes in hex, readable by the owner only', async () => {
    const file = join(dir, 'state', 'gate-token')
    const { token, created } = await initGateToken(file)
    expect(created).toBe(true)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect((await readFile(file, 'utf8')).trim()).toBe(token)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('keeps a token that is already there, trailing newline and all', async () => {
    const file = join(dir, 'gate-token')
    await writeFile(file, 'from-the-host\n', { mode: 0o600 })
    expect(await initGateToken(file)).toEqual({ token: 'from-the-host', created: false })
  })

  it('refuses an empty file rather than accepting an empty token', async () => {
    const file = join(dir, 'gate-token')
    await writeFile(file, '\n')
    await expect(initGateToken(file)).rejects.toThrow(/empty/)
  })
})

describe('tokenMatches', () => {
  it.each([
    ['the same token', 'abc', true],
    ['another token', 'abd', false],
    ['a prefix', 'ab', false],
    ['nothing', undefined, false],
  ])('%s', (_name, given, expected) => {
    expect(tokenMatches('abc', given)).toBe(expected)
  })
})

describe('GateAlerts', () => {
  const make = (now: () => number, notify = vi.fn(async () => 1)) =>
    new GateAlerts({ file: join(dir, 'gate-alerts.json'), now, notify })

  it('remembers across a restart, so the same gate does not ring twice in the window', async () => {
    const notify = vi.fn(async () => 1)
    const first = make(() => 1_000, notify)
    await first.load()
    await first.ring(BODY)
    expect((await stat(join(dir, 'gate-alerts.json'))).mode & 0o777).toBe(0o600)

    const second = make(() => 1_000 + GATE_DEDUP_MS - 1, notify)
    await second.load()
    expect(await second.ring(BODY)).toEqual({ sent: 0, deduplicated: true })
    expect(notify).toHaveBeenCalledOnce()
  })

  it('saves before pushing: a failed push is not retried into a second ring', async () => {
    const notify = vi.fn(async () => {
      throw new Error('push service down')
    })
    const alerts = make(() => 1_000, notify)
    expect(await alerts.ring(BODY)).toEqual({ sent: 0, deduplicated: false })
    expect(await alerts.ring(BODY)).toEqual({ sent: 0, deduplicated: true })
    expect(notify).toHaveBeenCalledOnce()
  })

  it('starts empty from an unreadable memory', async () => {
    await writeFile(join(dir, 'gate-alerts.json'), 'not json')
    const alerts = make(() => 1_000)
    await alerts.load()
    expect(await alerts.ring(BODY)).toEqual({ sent: 1, deduplicated: false })
  })
})
