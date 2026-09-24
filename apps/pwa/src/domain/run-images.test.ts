import { describe, expect, it } from 'vitest'
import { attachmentFileName, runImageUrl, scopedAttachmentUrl } from './run-images.ts'

describe('attachmentFileName', () => {
  it.each([
    ['/api/v1/runs/r-1/images/2.png', '2.png'],
    ['/api/runs/r-1/images/screenshot-1.png', 'screenshot-1.png'],
    ['/api/v1/runs/r-1/images/pasted_3.JPEG?v=2#x', 'pasted_3.JPEG'],
    ['https://cezar.example/api/v1/runs/r-1/images/a.webp', 'a.webp'],
    ['/api/v1/runs/r-1/images/..', undefined],
    ['/api/v1/runs/r-1/images/.', undefined],
    ['/api/v1/runs/r-1/images/a%2F..%2Fb.png', undefined],
    ['/api/v1/runs/r-1/images/a b.png', undefined],
    ['/api/v1/runs/r-1/images/', undefined],
    ['/api/v1/runs/r-1/other/a.png', undefined],
    ['a.png', undefined],
    ['', undefined],
  ])('%j → %j', (url, file) => {
    expect(attachmentFileName(url)).toBe(file)
  })
})

describe('runImageUrl', () => {
  it('builds the project-scoped route', () => {
    expect(runImageUrl('proj', 'r-1', '2.png')).toBe('/api/v1/p/proj/runs/r-1/images/2.png')
  })

  it('encodes the project and run ids', () => {
    expect(runImageUrl('a/b', 'r 1', '2.png')).toBe('/api/v1/p/a%2Fb/runs/r%201/images/2.png')
  })

  it.each(['..', '../x.png', 'a/b.png', 'a?.png', ''])('refuses %j', (file) => {
    expect(runImageUrl('proj', 'r-1', file)).toBeUndefined()
  })
})

describe('scopedAttachmentUrl', () => {
  it('keeps only the file name of the recorded URL', () => {
    expect(scopedAttachmentUrl('proj', 'r-1', '/api/v1/runs/OTHER-RUN/images/2.png')).toBe(
      '/api/v1/p/proj/runs/r-1/images/2.png',
    )
  })

  it('refuses a recorded URL without a plain file name', () => {
    expect(scopedAttachmentUrl('proj', 'r-1', '/api/v1/runs/r-1/images/..')).toBeUndefined()
  })
})
