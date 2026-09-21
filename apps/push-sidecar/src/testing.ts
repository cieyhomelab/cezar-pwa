/** Fixtures shared by the sidecar's tests. Not imported by `index.ts`, so never bundled. */

export const APPLE = 'https://web.push.apple.com/QGuQyavXutnMb'

export const subscription = (endpoint = APPLE) => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
})
