import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderLimits, PushPayload } from '@cezar-pwa/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitAlerts } from './limit-alerts.ts'

const NOW = new Date('2026-09-25T12:00:00Z')
const RESET = '2026-09-25T14:00:00Z'

const reading = (usedPercent: number, resetsAt = RESET): ProviderLimits[] => [
  {
    provider: 'codex',
    account: 'default',
    status: 'ok',
    observedAt: NOW.toISOString(),
    windows: [{ kind: 'five_hour', usedPercent, resetsAt }],
  },
]

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'limit-alerts-'))
  file = join(dir, 'state', 'limit-alerts.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function alerts(over: { busy?: boolean; now?: Date; notify?: (payload: PushPayload) => Promise<unknown> | void } = {}) {
  const notify = vi.fn(over.notify ?? (() => {}))
  const log = vi.fn<(message: string) => void>()
  const instance = new LimitAlerts({
    file,
    threshold: 90,
    busy: () => over.busy ?? true,
    notify,
    log,
    now: () => over.now ?? NOW,
  })
  return { instance, notify, log }
}

describe('LimitAlerts', () => {
  it('pushes once per crossing, not on every poll', async () => {
    const { instance, notify } = alerts()
    await instance.load()
    await instance.check(reading(80))
    await instance.check(reading(91))
    await instance.check(reading(94))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ kind: 'limit', provider: 'codex', window: 'five_hour', level: 'near' })
  })

  it('does not ring again after a restart before the reset', async () => {
    const first = alerts()
    await first.instance.load()
    await first.instance.check(reading(95))
    expect(first.notify).toHaveBeenCalledTimes(1)

    const second = alerts()
    await second.instance.load()
    await second.instance.check(reading(96))
    expect(second.notify).not.toHaveBeenCalled()
  })

  it('rings again once the window has reset', async () => {
    const first = alerts()
    await first.instance.load()
    await first.instance.check(reading(95))
    const later = alerts({ now: new Date('2026-09-25T15:00:00Z') })
    await later.instance.load()
    await later.instance.check(reading(92, '2026-09-25T20:00:00Z'))
    expect(later.notify).toHaveBeenCalledTimes(1)
  })

  it('stays silent while nothing is queued or running', async () => {
    const { instance, notify } = alerts({ busy: false })
    await instance.load()
    await instance.check(reading(100))
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps the memory in a 0600 file holding no numbers but the level and reset', async () => {
    const { instance } = alerts()
    await instance.load()
    await instance.check(reading(95))
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      'codex/default/five_hour': { level: 'near', resetsAt: RESET },
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('does not retry a failed push into a second ring', async () => {
    const { instance, notify, log } = alerts({
      notify: () => {
        throw new Error('push service down')
      },
    })
    await instance.load()
    await instance.check(reading(95))
    await instance.check(reading(95))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('limit alert: push failed')
  })

  it('starts empty from an unreadable memory file', async () => {
    const { instance, log } = alerts()
    await instance.check(reading(95)) // creates the directory
    await writeFile(file, 'not json')
    await instance.load()
    expect(instance.remembered()).toEqual({})
    expect(log).toHaveBeenCalledWith('limit alerts: memory unreadable, starting empty')
  })
})
