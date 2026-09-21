import { describe, expect, it } from 'vitest'
import {
  applicationServerKey,
  type PushEnvironment,
  type PushPermission,
  pushAvailability,
  sameKey,
} from './push-setup.ts'

const everything: PushEnvironment = { standalone: true, serviceWorker: true, pushManager: true, notification: true }

describe('pushAvailability', () => {
  const rows: [string, Partial<PushEnvironment>, PushPermission, string][] = [
    ['installed, capable, never asked', {}, 'default', 'available'],
    ['installed, capable, already granted', {}, 'granted', 'available'],
    ['installed, refused once', {}, 'denied', 'denied'],
    ['a browser tab shows how to install (FR-037)', { standalone: false }, 'default', 'install'],
    // Safari in a tab exposes no PushManager: still "install", never "this phone cannot".
    [
      'a Safari tab with no push at all is still "install"',
      { standalone: false, pushManager: false, notification: false },
      'unsupported',
      'install',
    ],
    ['installed on iOS < 16.4 (no PushManager)', { pushManager: false }, 'default', 'unsupported'],
    ['installed without a service worker', { serviceWorker: false }, 'default', 'unsupported'],
    ['installed without the Notification API', { notification: false }, 'unsupported', 'unsupported'],
  ]

  it.each(rows)('%s', (_name, env, permission, expected) => {
    expect(pushAvailability({ ...everything, ...env }, permission)).toBe(expected)
  })
})

describe('applicationServerKey', () => {
  it('decodes base64url without padding', () => {
    // "hello?>" → base64 "aGVsbG8/Pg==" → base64url "aGVsbG8_Pg"
    expect([...applicationServerKey('aGVsbG8_Pg')]).toEqual([...new TextEncoder().encode('hello?>')])
  })

  it('decodes a real 65-byte VAPID public key', () => {
    const key = 'BPpbtCsdAm_BdyJwV812MSbdh2qolBEg8jHCrz_gn-ukYsPfNenr1sKDy6sMZDkOTMDZ2EhZwPH8f6Zw9ZQ2Pv4'
    const bytes = applicationServerKey(key)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(0x04)
  })
})

describe('sameKey', () => {
  const key = new Uint8Array([4, 1, 2])
  it('treats a missing stored key as the same (nothing to compare)', () => {
    expect(sameKey(null, key)).toBe(true)
  })
  it('compares byte for byte', () => {
    expect(sameKey(new Uint8Array([4, 1, 2]).buffer, key)).toBe(true)
    expect(sameKey(new Uint8Array([4, 1, 3]).buffer, key)).toBe(false)
    expect(sameKey(new Uint8Array([4, 1]).buffer, key)).toBe(false)
  })
})
