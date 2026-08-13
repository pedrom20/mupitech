import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HACK_LINES = [
  '[!] UNAUTHORIZED ACCESS DETECTED',
  '[!] Bypassing firewall... 100%',
  '[!] Connecting to fleet mainframe...',
  '[!] Extracting device credentials...',
  '[!] Disabling security cameras...',
  '[!] SYSTEM COMPROMISED',
]

const CHAR_DELAY_MS = 14
const LINE_PAUSE_MS = 220
const REVEAL_DELAY_MS = 900
const HOLD_AFTER_REVEAL_MS = 2600

interface HackedOverlayProps {
  onDone: () => void
}

/** One-shot prank overlay — typed by "hacked" anywhere on the page. Types
 * out a fake breach sequence, then reveals it was a joke and dismisses
 * itself. Unlike the retro/MS-DOS eggs this isn't a persistent theme, so
 * there's no localStorage/toggle — it just plays once and goes away. */
const HackedOverlay: React.FC<HackedOverlayProps> = ({ onDone }) => {
  const { t } = useTranslation()
  const [lines, setLines] = useState<string[]>([])
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const typed: string[] = []

    const typeLine = (lineIndex: number) => {
      if (cancelled) return
      if (lineIndex >= HACK_LINES.length) {
        setTimeout(() => {
          if (cancelled) return
          setRevealed(true)
          setTimeout(() => { if (!cancelled) onDone() }, HOLD_AFTER_REVEAL_MS)
        }, REVEAL_DELAY_MS)
        return
      }
      const fullLine = HACK_LINES[lineIndex]
      let charIndex = 0
      typed.push('')

      const typeChar = () => {
        if (cancelled) return
        if (charIndex > fullLine.length) {
          setTimeout(() => typeLine(lineIndex + 1), LINE_PAUSE_MS)
          return
        }
        typed[lineIndex] = fullLine.slice(0, charIndex)
        setLines([...typed])
        charIndex += 1
        setTimeout(typeChar, CHAR_DELAY_MS)
      }
      typeChar()
    }

    typeLine(0)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`fm-hacked-overlay ${revealed ? 'fm-hacked-overlay-reveal' : 'fm-hacked-overlay-glitch'}`}>
      {!revealed ? (
        <>
          {lines.join('\n')}
          <span className="fm-hacked-cursor">█</span>
        </>
      ) : (
        <div className="fm-hacked-reveal-text">
          <div className="fm-hacked-reveal-emoji">😄</div>
          <div>{t('easterEgg.hackedReveal')}</div>
          <small>{t('easterEgg.hackedRevealHint')}</small>
        </div>
      )}
    </div>
  )
}

export default HackedOverlay
