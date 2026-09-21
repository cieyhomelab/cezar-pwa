import { useEffect, useLayoutEffect, useRef } from 'react'

/** A row the viewport is pinned to: its key, its section, and where its top was on screen. */
type Anchor = { key: string; section: string | null; top: number }

const ROW_SELECTOR = '[data-run-key]'

function sectionOf(element: Element): string | null {
  return element.closest('section')?.getAttribute('aria-labelledby') ?? null
}

/** The rows currently on screen, top to bottom — the candidates to pin to. */
function captureAnchors(): Anchor[] {
  const anchors: Anchor[] = []
  for (const element of document.querySelectorAll(ROW_SELECTOR)) {
    const { top, bottom } = element.getBoundingClientRect()
    if (bottom <= 0) continue
    if (top >= window.innerHeight) break
    anchors.push({ key: element.getAttribute('data-run-key')!, section: sectionOf(element), top })
    if (anchors.length >= 5) break
  }
  return anchors
}

/**
 * FR-010: "without the list jumping". When a live change lands while the operator is scrolled
 * into the list — a task above moving sections, a new task appearing at the top — the rows they
 * were looking at stay where they were on screen.
 *
 * Done by hand because Safari's CSS scroll anchoring cannot be relied on. The pin is the first
 * visible row that is still in the section it was in: a row that itself moved sections is the
 * change, and following it would be the jump this exists to prevent.
 *
 * At the very top nothing is pinned — there, new work appearing above is what should be seen.
 */
export function useScrollAnchor(data: unknown): void {
  const anchors = useRef<Anchor[]>([])

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        anchors.current = captureAnchors()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  useLayoutEffect(() => {
    const previous = anchors.current
    if (window.scrollY > 0) {
      for (const anchor of previous) {
        const element = [...document.querySelectorAll(ROW_SELECTOR)].find(
          (row) => row.getAttribute('data-run-key') === anchor.key,
        )
        if (!element || sectionOf(element) !== anchor.section) continue
        const shift = element.getBoundingClientRect().top - anchor.top
        if (shift !== 0) window.scrollBy(0, shift)
        break
      }
    }
    anchors.current = captureAnchors()
  }, [data])
}
