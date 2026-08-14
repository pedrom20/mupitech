import React, { useEffect, useRef } from 'react'

interface CodeInputProps {
  length?: number
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
}

/** A row of single-digit boxes for a 6-digit MFA code, instead of one
 * plain text input — auto-advances on type, handles backspace/arrow
 * navigation, and splits a pasted code across all boxes at once. */
const CodeInput: React.FC<CodeInputProps> = ({
  length = 6, value, onChange, onComplete, disabled, autoFocus,
}) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length }, (_, i) => value[i] || '')

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setDigitAt = (index: number, digit: string) => {
    const next = digits.slice()
    next[index] = digit
    const joined = next.join('')
    onChange(joined)
    if (joined.length === length) onComplete?.(joined)
  }

  const handleChange = (index: number, raw: string) => {
    const digitsOnly = raw.replace(/\D/g, '')
    if (!digitsOnly) {
      setDigitAt(index, '')
      return
    }
    if (digitsOnly.length > 1) {
      // A paste landed in a single box (some browsers route paste
      // through onChange rather than onPaste) — distribute it.
      const next = value.split('')
      for (let i = 0; i < digitsOnly.length && index + i < length; i++) {
        next[index + i] = digitsOnly[i]
      }
      const joined = next.join('').slice(0, length)
      onChange(joined)
      if (joined.length === length) onComplete?.(joined)
      const focusIndex = Math.min(index + digitsOnly.length, length - 1)
      inputRefs.current[focusIndex]?.focus()
      return
    }
    setDigitAt(index, digitsOnly)
    if (index < length - 1) inputRefs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!pasted) return
    e.preventDefault()
    const next = value.split('')
    for (let i = 0; i < pasted.length && index + i < length; i++) {
      next[index + i] = pasted[i]
    }
    const joined = next.join('').slice(0, length)
    onChange(joined)
    if (joined.length === length) onComplete?.(joined)
    const focusIndex = Math.min(index + pasted.length, length - 1)
    inputRefs.current[focusIndex]?.focus()
  }

  return (
    <div className="d-flex gap-2 justify-content-center">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          className="form-control text-center"
          style={{ width: '2.75rem', height: '3rem', fontSize: '1.25rem', padding: 0 }}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePaste(index, e)}
        />
      ))}
    </div>
  )
}

export default CodeInput
