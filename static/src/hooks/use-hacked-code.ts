import { useEffect, useRef } from 'react'

const HACKED_SEQUENCE = ['h', 'a', 'c', 'k', 'e', 'd']

/** Calls onTrigger() whenever "hacked" is typed anywhere on the page —
 * same mechanism as useKonamiCode/useDosCode, for the "system compromised"
 * prank overlay (a one-shot jump scare, not a persistent theme). */
export function useHackedCode(onTrigger: () => void) {
  const positionRef = useRef(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const expected = HACKED_SEQUENCE[positionRef.current]
      const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (pressed === expected) {
        positionRef.current += 1
        if (positionRef.current === HACKED_SEQUENCE.length) {
          positionRef.current = 0
          onTrigger()
        }
      } else {
        positionRef.current = pressed === HACKED_SEQUENCE[0] ? 1 : 0
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onTrigger])
}
