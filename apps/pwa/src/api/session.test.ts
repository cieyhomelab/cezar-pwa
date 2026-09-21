import { afterEach, describe, expect, it, vi } from 'vitest'
import { perimeterPost } from './http.ts'
import { SESSION_END_PATH, endSession } from './session.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('endSession', () => {
  it('posts to the perimeter, same-origin, with no body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await expect(endSession()).resolves.toBe(true)
    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe(SESSION_END_PATH)
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(init?.body).toBeUndefined()
  })

  it.each([
    // The endpoint is not installed: the static shell refuses a POST.
    ['405 from the shell', () => new Response('<html>405</html>', { status: 405 })],
    // A cross-origin guard, or a gate in front of the endpoint.
    ['403', () => new Response('<html>403</html>', { status: 403 })],
    // Anything else that is not the endpoint's own answer.
    ['200 with the shell', () => new Response('<!doctype html>', { status: 200 })],
  ])('counts only a 204 — not %s', async (_, answer) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer())
    await expect(endSession()).resolves.toBe(false)
  })

  it('never throws: an unreachable perimeter is "not ended"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Load failed'))
    await expect(endSession()).resolves.toBe(false)
  })
})

describe('perimeterPost', () => {
  it('refuses anything outside the perimeter’s own paths', async () => {
    await expect(perimeterPost('/api/v1/health')).rejects.toThrow('/m/session/')
    await expect(perimeterPost('/m/push/test')).rejects.toThrow('/m/session/')
  })
})
