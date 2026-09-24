import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Closer than this to the end counts as "at the bottom": a thumb never lands on the exact pixel. */
export const AT_BOTTOM_PX = 96

const contentHeight = () => document.documentElement.scrollHeight

/** How far the viewport's bottom is from the end of `height` worth of content. */
const distanceFromEnd = (height: number) => height - (window.scrollY + window.innerHeight)

/** Instant, never smooth: a smooth scroll still under way when the next line lands would read as
 *  "scrolled up" and stop the following. */
function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight })
}

/**
 * FR-019: the transcript follows new content only while the operator is at its end. Scrolled up,
 * they stay where they are and `unseen` turns on, which the screen shows as a "new messages"
 * button. Reaching the end, by hand or by the button, turns it off.
 *
 * `signature` changes when the transcript's content does (`transcriptSignature`), not on every
 * re-render. `ready` opens the screen at the newest entry, once: the most recent stretch is what
 * the operator came for.
 *
 * `reach` is how far back the transcript runs (`pageReach`). When it moves back, the new content
 * arrived above (FR-049's older pages), not at the end: nothing is followed and nothing is
 * announced. Moving forward (a refetch that could not keep the older lines) is ordinary news.
 *
 * The page scrolls the window, not a box: that is what gives iOS its native scroll, the status-bar
 * tap to top, and the collapsing toolbar in Safari.
 */
export function useFollowBottom(signature: string, ready: boolean, reach?: number) {
  const [unseen, setUnseen] = useState(false)
  const opened = useRef(false)
  const lastSignature = useRef(signature)
  const lastReach = useRef(reach)
  /** The content's height before the latest change. Whether the reader was at the end is judged
   *  against it, synchronously: a `scroll` event can still be queued when a line lands (WebKit
   *  dispatches them with the next frame), so the listener alone would answer too late. */
  const heightBefore = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      heightBefore.current = contentHeight()
      if (distanceFromEnd(heightBefore.current) <= AT_BOTTOM_PX) setUnseen(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Layout effect: the jump to the end happens before the frame is painted, so following reads as
  // the text growing in place rather than flickering down.
  useLayoutEffect(() => {
    if (!ready) return
    const wasAtEnd = distanceFromEnd(heightBefore.current) <= AT_BOTTOM_PX
    if (!opened.current) {
      opened.current = true
      lastSignature.current = signature
      scrollToBottom()
    } else if (reach !== undefined && lastReach.current !== undefined && reach < lastReach.current) {
      lastSignature.current = signature
    } else if (signature !== lastSignature.current) {
      lastSignature.current = signature
      if (wasAtEnd) scrollToBottom()
      else setUnseen(true)
    }
    lastReach.current = reach
    heightBefore.current = contentHeight()
  }, [signature, ready, reach])

  const jump = useCallback(() => {
    setUnseen(false)
    scrollToBottom()
    heightBefore.current = contentHeight()
  }, [])

  return { unseen, jump }
}
