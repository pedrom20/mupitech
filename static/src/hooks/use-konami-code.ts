import { useEffect, useRef } from 'react'

const KONAMI_SEQUENCE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
]

/** Calls onTrigger() whenever the Konami code is typed anywhere on the page. */
export function useKonamiCode(onTrigger: () => void) {
  const positionRef = useRef(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const expected = KONAMI_SEQUENCE[positionRef.current]
      const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (pressed === expected) {
        positionRef.current += 1
        if (positionRef.current === KONAMI_SEQUENCE.length) {
          positionRef.current = 0
          onTrigger()
        }
      } else {
        positionRef.current = pressed === KONAMI_SEQUENCE[0] ? 1 : 0
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onTrigger])
}
