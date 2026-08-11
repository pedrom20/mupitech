import { useEffect, useRef } from 'react'

const DOS_SEQUENCE = ['m', 's', 'd', 'o', 's']

/** Calls onTrigger() whenever "msdos" is typed anywhere on the page —
 * same mechanism as useKonamiCode, different sequence, for the second
 * (MS-DOS-style) easter egg theme. */
export function useDosCode(onTrigger: () => void) {
  const positionRef = useRef(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const expected = DOS_SEQUENCE[positionRef.current]
      const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (pressed === expected) {
        positionRef.current += 1
        if (positionRef.current === DOS_SEQUENCE.length) {
          positionRef.current = 0
          onTrigger()
        }
      } else {
        positionRef.current = pressed === DOS_SEQUENCE[0] ? 1 : 0
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onTrigger])
}
