import { describe, expect, it } from 'vitest'
import { ApiError, AuthRequiredError, NetworkError } from '../api/http.ts'
import { apiErrorDetail } from './errors.ts'
import { en } from './en.ts'

describe('apiErrorDetail', () => {
  it("passes Cezar's own reason through, word for word (FR-032)", () => {
    expect(apiErrorDetail(new ApiError('run not found', 404))).toBe('run not found')
  })

  it.each([
    ['unexpected-shape' as const, en.apiError['unexpected-shape']],
    ['invalid-json' as const, en.apiError['invalid-json']],
    ['not-routed' as const, en.apiError['not-routed']],
  ])('says %s in our own words rather than in the error message', (code, expected) => {
    // The message is the developer-facing note; nothing of it may reach the screen.
    const detail = apiErrorDetail(new ApiError('unexpected response shape', 200, code))
    expect(detail).toBe(expected)
    expect(detail).not.toBe('unexpected response shape')
  })

  it('adds nothing for a status that came with no reason', () => {
    expect(apiErrorDetail(new ApiError('HTTP 502', 502, 'no-detail'))).toBeUndefined()
  })

  it.each([
    ['a refusal', new AuthRequiredError(403)],
    ['a dead network', new NetworkError('could not reach Cezar')],
    ['anything else', 'boom'],
  ])('adds nothing for %s — those screens say their own thing', (_name, error) => {
    expect(apiErrorDetail(error)).toBeUndefined()
  })
})
