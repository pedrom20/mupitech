import { useRef } from 'react'

const TAP_COUNT = 7
const TAP_WINDOW_MS = 2500

/**
 * Mobile-friendly equivalent of the Konami code: calls onTrigger() after
 * TAP_COUNT taps register() calls in quick succession. Returns true when the
 * tap counted toward/completed the sequence, so callers can prevent default
 * behavior (e.g. link navigation) only once the pattern is actually engaged.
 */
export function useTapTrigger(onTrigger: () => void) {
  const countRef = useRef(0)
  const lastTapRef = useRef(0)

  const register = (): boolean => {
    const now = Date.now()
    if (now - lastTapRef.current > TAP_WINDOW_MS) {
      countRef.current = 0
    }
    lastTapRef.current = now
    countRef.current += 1

    if (countRef.current >= TAP_COUNT) {
      countRef.current = 0
      onTrigger()
      return true
    }
    return countRef.current > 1
  }

  return register
}
