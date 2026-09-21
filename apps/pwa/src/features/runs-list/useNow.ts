import { useEffect, useState } from 'react'

/**
 * The current time, re-read every `intervalMs`, so "26 min" does not freeze on a list that
 * stays open. Also re-read on return to the foreground: a phone that slept for an hour must
 * not wake up showing ages from before it slept.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, intervalMs)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])

  return now
}
