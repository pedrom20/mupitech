import { useCallback, useRef } from 'react'

/** Returns an onClick/onTouchEnd handler that calls onTrigger() after
 * `count` taps on the same element within `windowMs` of each other —
 * a touch-friendly alternative to keyboard-only easter egg triggers
 * (useKonamiCode/useDosCode), for devices with no physical keyboard. */
export function useTapSequence(onTrigger: () => void, count = 5, windowMs = 1500) {
  const tapsRef = useRef(0)
  const lastTapRef = useRef(0)

  return useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current > windowMs) {
      tapsRef.current = 0
    }
    lastTapRef.current = now
    tapsRef.current += 1
    if (tapsRef.current >= count) {
      tapsRef.current = 0
      onTrigger()
    }
  }, [onTrigger, count, windowMs])
}
