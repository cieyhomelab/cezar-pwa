import { useEffect, useRef, useState } from 'react'

/** How far the finger must drag (after resistance) before letting go refreshes. */
export const PULL_THRESHOLD_PX = 64
/** The indicator never grows past this, however far the finger goes. */
export const PULL_MAX_PX = 96

/**
 * Finger travel → indicator height. Halved for the rubber-band feel native lists have, capped,
 * and zero for an upward drag.
 */
export function pullDistance(dragPx: number): number {
  if (dragPx <= 0) return 0
  return Math.min(PULL_MAX_PX, dragPx / 2)
}

export function isArmed(distance: number): boolean {
  return distance >= PULL_THRESHOLD_PX
}

/**
 * FR-011: pull to refresh.
 *
 * An installed PWA on iOS has no native pull-to-refresh — there is no browser chrome to own
 * the gesture, and the shell sets `overscroll-behavior-y: none` so it does not rubber-band
 * like a web page. So the gesture is rebuilt here: a drag that STARTS at the very top of the
 * page and goes down. A drag that starts mid-list is a scroll, and is left alone.
 *
 * Listeners are passive — nothing here calls `preventDefault`, so scrolling is never blocked.
 */
export function usePullToRefresh(onRefresh: () => void, enabled = true) {
  const [distance, setDistance] = useState(0)
  const startY = useRef<number | null>(null)
  const current = useRef(0)
  // The latest callback, without re-attaching listeners on every render.
  const refresh = useRef(onRefresh)
  useEffect(() => {
    refresh.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!enabled) return

    const onStart = (event: TouchEvent) => {
      startY.current = window.scrollY <= 0 && event.touches.length === 1 ? event.touches[0]!.clientY : null
    }
    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return
      current.current = pullDistance(event.touches[0]!.clientY - startY.current)
      setDistance(current.current)
    }
    const onEnd = () => {
      if (startY.current !== null && isArmed(current.current)) refresh.current()
      startY.current = null
      current.current = 0
      setDistance(0)
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])

  return { distance, armed: isArmed(distance) }
}
