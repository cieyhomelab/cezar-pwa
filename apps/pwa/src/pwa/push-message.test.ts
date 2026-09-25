import { attentionPayload } from '@cezar-pwa/shared'
import { describe, expect, it } from 'vitest'
import { appPathFor, notificationFor, pickAppWindow, readPushPayload, targetUrl } from './push-message.ts'

const ORIGIN = 'https://cezar.example.test'

describe('readPushPayload', () => {
  it('keeps the known string fields and drops the rest', () => {
    expect(
      readPushPayload({ kind: 'attention', runId: 'r1', projectId: 'p', title: 7, extra: 'x', reason: '' }),
    ).toEqual({ kind: 'attention', runId: 'r1', projectId: 'p' })
  })

  it('turns anything that is not an object into a bare attention payload', () => {
    expect(readPushPayload(undefined)).toEqual({ kind: 'attention' })
    expect(readPushPayload('text')).toEqual({ kind: 'attention' })
  })
})

describe('notificationFor', () => {
  it('says which task, which project and why (FR-038), and opens the transcript (FR-041)', () => {
    const payload = attentionPayload(
      { projectId: 'cezar-pwa', id: 'a1b2', title: 'prompt', titleSummary: 'Settings screen', status: 'waiting' },
      'Cezar PWA',
    )
    const { title, options } = notificationFor(readPushPayload(JSON.parse(JSON.stringify(payload))))
    expect(title).toBe('Settings screen')
    expect(options.body).toBe('Cezar PWA · Waiting for your answer')
    expect(options.data.url).toBe('/m/p/cezar-pwa/runs/a1b2')
    expect(options.icon).toBe('/m/icons/icon-192.png')
  })

  it.each([
    ['needs review', 'Waiting for review'],
    ['failed', 'Ended with an error'],
    ['needs permission', 'Asking for permission'],
    // A label the phone has not heard of yet: the list's word if it has one, else the raw key.
    ['running', 'working'],
    ['brand new', 'brand new'],
  ])('reason %s → %s', (reason, text) => {
    expect(notificationFor({ kind: 'attention', projectName: 'P', reason }).options.body).toBe(`P · ${text}`)
  })

  it('tags per task, so a newer notification about it replaces the older one', () => {
    const first = notificationFor({ kind: 'attention', projectId: 'p', runId: 'r1', reason: 'needs you' })
    const second = notificationFor({ kind: 'attention', projectId: 'p', runId: 'r1', reason: 'failed' })
    const other = notificationFor({ kind: 'attention', projectId: 'q', runId: 'r1', reason: 'failed' })
    expect(first.options.tag).toBe(second.options.tag)
    expect(other.options.tag).not.toBe(first.options.tag)
  })

  it('rings the replacement: a new transition of the same task is news (FR-039)', () => {
    const spec = notificationFor({ kind: 'attention', projectId: 'p', runId: 'r1', reason: 'failed' })
    expect(spec.options.renotify).toBe(true)
    // `renotify` without a tag is a TypeError in the browser, and the worker would show nothing.
    expect(spec.options.tag).toBeTruthy()
    expect(notificationFor({ kind: 'attention' }).options.tag).toBeTruthy()
  })

  it('degrades to the app and a generic reason when the payload names nothing', () => {
    const { title, options } = notificationFor({ kind: 'attention' })
    expect(title).toBe('Cezar')
    expect(options.body).toBe('Needs attention')
    expect(options.data.url).toBe('/m/')
  })

  it('shows a test as a test, landing on the list', () => {
    const { title, options } = notificationFor({ kind: 'test' })
    expect(title).toBe('Cezar')
    expect(options.body).toBe('Notifications are working.')
    expect(options.data.url).toBe('/m/')
  })
})

describe('targetUrl', () => {
  it('encodes ids', () => {
    expect(targetUrl({ kind: 'attention', projectId: 'a b', runId: 'c/d' })).toBe('/m/p/a%20b/runs/c%2Fd')
  })
})

describe('appPathFor', () => {
  it.each([
    ['/m/p/x/runs/y', '/p/x/runs/y'],
    [`${ORIGIN}/m/p/x/runs/y`, '/p/x/runs/y'],
    ['/m/', '/'],
    ['/m/settings?tab=1', '/settings?tab=1'],
  ])('%s → %s', (url, path) => {
    expect(appPathFor(url, ORIGIN)).toBe(path)
  })

  it.each([['/'], ['/mx/p'], ['/api/v1/health'], ['https://evil.example/m/p/x/runs/y'], [42], [undefined]])(
    'ignores %s',
    (url) => {
      expect(appPathFor(url, ORIGIN)).toBeUndefined()
    },
  )
})

describe('pickAppWindow', () => {
  it('reuses the first window inside the app, never the cockpit', () => {
    const windows = [{ url: `${ORIGIN}/` }, { url: `${ORIGIN}/m/p/x/runs/y` }, { url: `${ORIGIN}/m/` }]
    expect(pickAppWindow(windows)).toBe(windows[1])
    expect(pickAppWindow([{ url: `${ORIGIN}/projects` }])).toBeUndefined()
  })
})

describe('limit notifications (#94)', () => {
  const NOW = Date.parse('2026-09-25T12:00:00Z')
  const limit = {
    kind: 'limit',
    provider: 'claude',
    account: 'default',
    window: 'five_hour',
    level: 'near',
    usedPercent: 92,
    resetsAt: '2026-09-25T13:20:00Z',
  }

  it('reads the limit fields, dropping ones of the wrong type', () => {
    expect(readPushPayload({ ...limit, usedPercent: '92', level: 'loud', extra: 1 })).toEqual({
      kind: 'limit',
      provider: 'claude',
      account: 'default',
      window: 'five_hour',
      resetsAt: '2026-09-25T13:20:00Z',
    })
  })

  it('names the window, how full, and when it resets, and opens the Limits screen', () => {
    const { title, options } = notificationFor(readPushPayload(limit), NOW)
    expect(title).toBe('Claude · 5-hour window')
    expect(options.body).toBe('92% used · resets in 1h 20m · tasks are waiting to run')
    expect(options.data.url).toBe('/m/limits')
    expect(targetUrl(readPushPayload(limit))).toBe('/m/limits')
  })

  it('names a non-default account and says when a window is used up', () => {
    const { title, options } = notificationFor(
      readPushPayload({ ...limit, account: 'work', window: 'weekly_model', model: 'opus', level: 'exhausted', usedPercent: 100 }),
      NOW,
    )
    expect(title).toBe('Claude · Weekly · Opus')
    expect(options.body).toBe('Account work · used up · resets in 1h 20m · tasks are waiting to run')
  })

  it('tags per window, so exhausted replaces near and rings', () => {
    const near = notificationFor(readPushPayload(limit), NOW).options
    const exhausted = notificationFor(readPushPayload({ ...limit, level: 'exhausted' }), NOW).options
    expect(exhausted.tag).toBe(near.tag)
    expect(exhausted.renotify).toBe(true)
    expect(notificationFor(readPushPayload({ ...limit, window: 'weekly' }), NOW).options.tag).not.toBe(near.tag)
  })

  it('shows a provider and window it has not heard of by their keys', () => {
    const { title } = notificationFor(readPushPayload({ kind: 'limit', provider: 'gemini', window: 'daily' }), NOW)
    expect(title).toBe('gemini · daily')
  })
})
