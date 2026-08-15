import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaExclamationTriangle, FaRocket, FaArrowLeft, FaSync, FaCheckCircle } from 'react-icons/fa'

interface Props {
  theme: 'retro' | 'dos'
  onBack: () => void
  children: React.ReactNode
}

type Phase = 'error' | 'transition' | 'revealed'

const DOS_UPDATE_LINE_KEYS = [
  'auth.easterEgg.dos.updateLine1',
  'auth.easterEgg.dos.updateLine2',
  'auth.easterEgg.dos.updateLine3',
  'auth.easterEgg.dos.updateLine4',
]

/** Both easter-egg themes (see app.tsx's ThemeContext) get a joke instead
 * of the real MFA challenge screen the instant one is reached — a fake
 * "couldn't load the 2FA module" error in that theme's own visual
 * language, with a way out that reveals the real MFA UI afterward.
 * Renders `children` (the real challenge markup from login.tsx) once
 * `phase === 'revealed'`, wrapped in a skin that escapes the theme's own
 * `[data-*-theme] *` !important overrides via selector specificity —
 * see _login-easter-egg.scss's `.fm-egg-future`/`.fm-egg-restored`
 * blocks, which both out-specify the blanket reset they're undoing. */
const MfaEasterEgg: React.FC<Props> = ({ theme, onBack, children }) => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('error')
  const [updateLine, setUpdateLine] = useState(0)

  useEffect(() => {
    if (phase !== 'transition') return
    if (theme === 'retro') {
      const timer = setTimeout(() => setPhase('revealed'), 2200)
      return () => clearTimeout(timer)
    }
    // DOS: step through fake update log lines, one every ~450ms, then reveal.
    if (updateLine >= DOS_UPDATE_LINE_KEYS.length) {
      const timer = setTimeout(() => setPhase('revealed'), 500)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setUpdateLine((n) => n + 1), 450)
    return () => clearTimeout(timer)
  }, [phase, theme, updateLine])

  if (phase === 'revealed') {
    // Retro reveals a deliberately over-the-top "futuristic" skin (the
    // joke: traveled far enough forward that MFA finally works); DOS
    // reveals the plain normal-theme look (the joke: "updating" fixed
    // it) — see _login-easter-egg.scss for both classes' overrides.
    return <div className={theme === 'retro' ? 'fm-egg-future' : 'fm-egg-restored'}>{children}</div>
  }

  if (phase === 'transition') {
    return theme === 'retro' ? (
      <div className="fm-egg-warp" aria-hidden="true">
        <div className="fm-egg-warp-streaks" />
        <p className="fm-egg-warp-label">{t('auth.easterEgg.retro.traveling')}</p>
      </div>
    ) : (
      <div className="fm-egg-dos-update">
        {DOS_UPDATE_LINE_KEYS.slice(0, updateLine).map((key) => (
          <p key={key} className="fm-egg-dos-line">
            <FaCheckCircle className="me-1" /> {t(key)}
          </p>
        ))}
      </div>
    )
  }

  return theme === 'retro' ? (
    <div className="fm-egg-error-card fm-egg-error-card--retro">
      <div className="fm-egg-error-card__titlebar">{t('auth.easterEgg.retro.titlebar')}</div>
      <div className="fm-egg-error-card__body">
        <FaExclamationTriangle className="fm-egg-error-card__icon" />
        <p className="fm-egg-error-card__message">{t('auth.easterEgg.retro.message')}</p>
        <p className="fm-egg-error-card__code">0x0000A7B2 — MFA32.DLL</p>
      </div>
      <div className="fm-egg-error-card__actions">
        <button type="button" className="fm-egg-btn" onClick={onBack}>
          <FaArrowLeft className="me-1" /> {t('auth.easterEgg.retro.back')}
        </button>
        <button type="button" className="fm-egg-btn fm-egg-btn--accent" onClick={() => setPhase('transition')}>
          <FaRocket className="me-1" /> {t('auth.easterEgg.retro.travel')}
        </button>
      </div>
    </div>
  ) : (
    <div className="fm-egg-error-card fm-egg-error-card--dos">
      <p className="fm-egg-dos-line">&gt; auth_module.exe</p>
      <p className="fm-egg-dos-line">&gt; {t('auth.easterEgg.dos.loading')}</p>
      <p className="fm-egg-dos-line fm-egg-dos-line--error">&gt; {t('auth.easterEgg.dos.error')}</p>
      <p className="fm-egg-dos-line fm-egg-dos-line--error">&gt; {t('auth.easterEgg.dos.detail')}</p>
      <div className="fm-egg-error-card__actions">
        <button type="button" className="fm-egg-btn fm-egg-btn--dos" onClick={onBack}>
          <FaArrowLeft className="me-1" /> {t('auth.easterEgg.dos.back')}
        </button>
        <button type="button" className="fm-egg-btn fm-egg-btn--dos fm-egg-btn--accent" onClick={() => { setUpdateLine(0); setPhase('transition') }}>
          <FaSync className="me-1" /> {t('auth.easterEgg.dos.update')}
        </button>
      </div>
    </div>
  )
}

export default MfaEasterEgg
