import React, { useEffect, useState } from 'react'

const BOOT_LINES = [
  'MUPITECH-DOS [Versão 1.0]',
  '(C) MupiTech. Todos os direitos reservados.',
  '',
  'A iniciar sistema...',
  'A carregar GESTOR.EXE...',
  '',
  'C:\\MUPITECH>_',
]

const CHAR_DELAY_MS = 18
const LINE_PAUSE_MS = 150
const HOLD_AFTER_MS = 500

interface DosBootOverlayProps {
  onDone: () => void
}

/** Plays once when the MS-DOS easter egg theme turns on — types out a
 * short boot banner line by line, then hands off to the real page. */
const DosBootOverlay: React.FC<DosBootOverlayProps> = ({ onDone }) => {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const typed: string[] = []

    const typeLine = (lineIndex: number) => {
      if (cancelled) return
      if (lineIndex >= BOOT_LINES.length) {
        setTimeout(() => { if (!cancelled) onDone() }, HOLD_AFTER_MS)
        return
      }
      const fullLine = BOOT_LINES[lineIndex]
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
        setTimeout(typeChar, fullLine ? CHAR_DELAY_MS : 0)
      }
      typeChar()
    }

    typeLine(0)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fm-dos-boot-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: '#0c0c0c',
        color: '#4ec9b0',
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: '1.1rem',
        padding: '2rem',
        whiteSpace: 'pre-wrap',
      }}
    >
      {lines.join('\n')}
      <span style={{ animation: 'dos-cursor-blink 1s steps(1) infinite' }}>█</span>
    </div>
  )
}

export default DosBootOverlay
