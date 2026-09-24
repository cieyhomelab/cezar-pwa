import { useCallback, useLayoutEffect, useRef } from 'react'

/** An entry the reader was looking at, and where its top was on screen. */
type Anchor = { key: string; top: number }

const ENTRY_SELECTOR = '[data-entry-key]'

/** The first few entries on screen, top to bottom: the candidates to pin to. */
function captureAnchors(): Anchor[] {
  const anchors: Anchor[] = []
  for (const element of document.querySelectorAll(ENTRY_SELECTOR)) {
    const { top, bottom } = element.getBoundingClientRect()
    if (bottom <= 0) continue
    if (top >= window.innerHeight) break
    anchors.push({ key: element.getAttribute('data-entry-key')!, top })
    if (anchors.length >= 5) break
  }
  return anchors
}

function findEntry(key: string): Element | undefined {
  for (const element of document.querySelectorAll(ENTRY_SELECTOR)) {
    if (element.getAttribute('data-entry-key') === key) return element
  }
  return undefined
}

/**
 * FR-049: older entries land above what the operator is reading "without moving what is on
 * screen". `note()` records where the visible entries are just before the cache write; after
 * the render that adds the older page, the first of them still present is put back where it was.
 *
 * Done by hand for the reason `useScrollAnchor` gives: Safari's CSS scroll anchoring cannot be
 * relied on. Where the browser has already anchored, the shift measured is zero.
 *
 * Pinned to entries, not turns: the turn the newest page opened mid-way gains its earlier
 * entries (and can change its id) when the page before lands.
 */
export function useKeepPlace(): { note: () => void } {
  const pending = useRef<Anchor[] | null>(null)

  const note = useCallback(() => {
    pending.current = captureAnchors()
  }, [])

  useLayoutEffect(() => {
    const anchors = pending.current
    if (anchors === null) return
    pending.current = null
    for (const anchor of anchors) {
      const element = findEntry(anchor.key)
      if (element === undefined) continue
      const shift = element.getBoundingClientRect().top - anchor.top
      if (shift !== 0) window.scrollBy(0, shift)
      return
    }
  })

  return { note }
}
