import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { FaSignInAlt, FaArrowLeft, FaShieldAlt, FaEnvelope, FaCheckCircle } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { AuthContext, ThemeContext } from '@/components/app'
import { auth, ApiError, type MfaChallenge } from '@/services/api'
import CodeInput from '@/components/shared/code-input'
import { MFA_METHOD_ICON } from '@/utils/mfaIcons'
import MfaEasterEgg from './mfa-easter-egg'
import type { MFAMethod } from '@/types'

const Login: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { refresh } = useContext(AuthContext)
  const { retro: retroTheme, dos: dosTheme } = useContext(ThemeContext)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const [forgotPasswordMode, setForgotPasswordMode] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  // Second factor: only entered once the first factor comes back with
  // mfa_required — no session exists yet at that point. A dual-MFA
  // login goes through this same state twice: the first factor's own
  // verify call comes back with another mfa_required (stage: 2) instead
  // of {success}, which resets challengeId/method/etc to the *second*
  // challenge rather than navigating away — see handleChallengeResult.
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [method, setMethod] = useState<MFAMethod | null>(null)
  const [availableMethods, setAvailableMethods] = useState<MFAMethod[]>([])
  const [pushMethods, setPushMethods] = useState<MFAMethod[]>([])
  const [stage, setStage] = useState<1 | 2>(1)
  const [dualRequired, setDualRequired] = useState(false)
  const [code, setCode] = useState('')
  const [pushStatus, setPushStatus] = useState<'pending' | 'timeout' | 'error'>('pending')
  const [pushError, setPushError] = useState('')
  // A completed factor briefly shows as "confirmed" (green border,
  // fade-out) before the actual navigate() away — otherwise the whole
  // challenge panel just vanishes the instant the last digit lands,
  // with nothing acknowledging it was accepted.
  const [success, setSuccess] = useState(false)

  // Shared by the credentials submit and every verify*() call below:
  // any of them can return either {success} (done) or a fresh
  // MfaChallenge (one more factor needed — either the very first one,
  // or dual-MFA's second, different-provider one). Returns true if a
  // challenge is now pending (caller should stop, e.g. not clear
  // pushStatus back to an unrelated state).
  const handleChallengeResult = (result: { success: true; username: string } | MfaChallenge): boolean => {
    if ('mfa_required' in result) {
      setChallengeId(result.challenge_id)
      setMethod(result.method)
      setAvailableMethods(result.available_methods || [result.method])
      setPushMethods(result.push_methods || [])
      setStage(result.stage || 1)
      if (result.dual_required !== undefined) setDualRequired(result.dual_required)
      setCode('')
      setPushStatus('pending')
      setPushError('')
      return true
    }
    setSuccess(true)
    setTimeout(() => {
      refresh()
      navigate('/')
    }, 350)
    return false
  }

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await auth.login(username, password)
      handleChallengeResult(result)
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('auth.invalidCredentials'),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetLoading(true)
    try {
      // Always resolves {success: true} regardless of whether the
      // email matches an account — see api.ts's own doc comment.
      // Showing the same "sent" state either way is the point, not an
      // oversight: the alternative (a distinct "no such email" error)
      // would let this form be used to check who has an account.
      await auth.requestPasswordReset(resetEmail)
      setResetSent(true)
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('auth.forgotPassword.error'),
      })
    } finally {
      setResetLoading(false)
    }
  }

  const backToLoginFromForgotPassword = () => {
    setForgotPasswordMode(false)
    setResetEmail('')
    setResetSent(false)
  }

  const submitMfaCode = async (submittedCode: string) => {
    if (!challengeId || submittedCode.length !== 6) return
    setLoading(true)
    try {
      const result = method === 'privacyidea'
        ? await auth.verifyPrivacyIDEA(challengeId, submittedCode)
        : await auth.verifyMfa(challengeId, submittedCode)
      handleChallengeResult(result)
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('auth.mfa.invalidCode'),
      })
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const handleMfaSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submitMfaCode(code)
  }

  // Dispatches to the right push-verify endpoint for whichever provider
  // is push-kind for this user right now — 'authpoint' never actually
  // reaches here (mfa.authpoint.authpoint_configured() is always False,
  // so it can never appear in push_methods), listed for exhaustiveness.
  const verifyPush = (challenge: string, m: MFAMethod) => {
    if (m === 'privacyidea') return auth.verifyPrivacyIDEAPush(challenge)
    return auth.verifyDuo(challenge)
  }

  const sendPush = async (challenge: string, m: MFAMethod) => {
    setPushStatus('pending')
    setPushError('')
    try {
      const result = await verifyPush(challenge, m)
      handleChallengeResult(result)
    } catch (error) {
      if (error instanceof ApiError && error.message === 'timeout') {
        setPushStatus('timeout')
      } else {
        setPushStatus('error')
        setPushError(error instanceof ApiError ? error.message : String(error))
      }
    }
  }

  useEffect(() => {
    if (challengeId && method && pushMethods.includes(method)) {
      sendPush(challengeId, method)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, method])

  const backToCredentials = () => {
    setChallengeId(null)
    setMethod(null)
    setAvailableMethods([])
    setPushMethods([])
    setStage(1)
    setDualRequired(false)
    setCode('')
    setPushStatus('pending')
    setPushError('')
    setSuccess(false)
  }

  // Same challenge_id works against every verify endpoint (see
  // auth_login's available_methods comment in fleet_manager/urls.py) —
  // switching methods is just changing which UI branch renders, no new
  // challenge or password re-entry needed.
  const switchMethod = (next: MFAMethod) => {
    setCode('')
    setPushStatus('pending')
    setPushError('')
    setMethod(next)
  }

  const otherMethods = availableMethods.filter((m) => m !== method)

  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
      <div className="fm-card fm-card-accent" style={{ maxWidth: '420px', width: '100%' }}>
        <div className="fm-card-header text-center">
          <h4 className="card-title mb-0">
            <span className="brand-highlight">MupiTech</span> {t('auth.brandSuffix')}
          </h4>
        </div>
        <div className="fm-card-body">
          {!challengeId ? (
            <form onSubmit={handleCredentialsSubmit}>
              <div className="mb-3">
                <label className="form-label fw-semibold">{t('auth.username')}</label>
                <input
                  type="text"
                  className="form-control"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="mb-4">
                <label className="form-label fw-semibold">{t('auth.password')}</label>
                <input
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <div className="text-end mt-2">
                  <button
                    type="button"
                    className="btn btn-link p-0 text-decoration-none"
                    onClick={() => setForgotPasswordMode(true)}
                  >
                    {t('auth.forgotPassword.link')}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                className="fm-btn-primary w-100"
                disabled={loading}
              >
                <FaSignInAlt />
                {loading ? t('common.loading') : t('auth.login')}
              </button>
            </form>
          ) : forgotPasswordMode ? (
            resetSent ? (
              <div className="text-center">
                <FaCheckCircle size={28} className="mb-2 text-success" />
                <p className="mb-4">{t('auth.forgotPassword.sent', { email: resetEmail })}</p>
                <button
                  type="button"
                  className="fm-btn-outline w-100"
                  onClick={backToLoginFromForgotPassword}
                >
                  <FaArrowLeft />
                  {t('auth.mfa.back')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPasswordSubmit}>
                <div className="text-center mb-3">
                  <FaEnvelope size={28} className="mb-2" />
                  <p className="mb-0 fw-semibold">{t('auth.forgotPassword.title')}</p>
                  <p className="form-text">{t('auth.forgotPassword.description')}</p>
                </div>
                <div className="mb-4">
                  <label className="form-label fw-semibold">{t('auth.forgotPassword.email')}</label>
                  <input
                    type="email"
                    className="form-control"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  className="fm-btn-primary w-100 mb-2"
                  disabled={resetLoading}
                >
                  <FaEnvelope />
                  {resetLoading ? t('common.loading') : t('auth.forgotPassword.submit')}
                </button>
                <button
                  type="button"
                  className="fm-btn-outline w-100"
                  onClick={backToLoginFromForgotPassword}
                  disabled={resetLoading}
                >
                  <FaArrowLeft />
                  {t('auth.mfa.back')}
                </button>
              </form>
            )
          ) : (() => {
            const challengeUi = (method && pushMethods.includes(method)) ? (() => {
              const PushIcon = MFA_METHOD_ICON[method]
              return (
                <div className={`fm-mfa-panel${success ? ' is-leaving' : ''}`} key={method}>
                  {dualRequired && (
                    <p className="text-center mb-2">
                      <span className="badge bg-info-subtle text-info-emphasis">
                        {t('auth.mfa.stepIndicator', { stage, total: 2 })}
                      </span>
                    </p>
                  )}
                  <div className="text-center mb-4">
                    <PushIcon size={28} className="mb-2" />
                    <p className="mb-0 fw-semibold">{t('auth.push.title')}</p>
                    {pushStatus === 'pending' && (
                      <p className="form-text">
                        <span className="spinner-border spinner-border-sm me-2" />
                        {t('auth.push.waiting', { app: t(`auth.push.appName.${method}`) })}
                      </p>
                    )}
                    {pushStatus === 'timeout' && (
                      <p className="form-text text-warning">{t('auth.push.timeout')}</p>
                    )}
                    {pushStatus === 'error' && (
                      <p className="form-text text-danger">{pushError || t('auth.push.denied')}</p>
                    )}
                  </div>
                  {pushStatus !== 'pending' && (
                    <button
                      type="button"
                      className="fm-btn-primary w-100 mb-2"
                      onClick={() => challengeId && sendPush(challengeId, method)}
                    >
                      <PushIcon />
                      {t('auth.push.retry')}
                    </button>
                  )}
                  {otherMethods.map((m) => {
                    const OtherIcon = MFA_METHOD_ICON[m]
                    return (
                      <button
                        key={m}
                        type="button"
                        className="btn btn-link w-100 mb-2 text-decoration-none"
                        onClick={() => switchMethod(m)}
                      >
                        <OtherIcon className="me-1" />
                        {t('auth.mfa.switchTo', { method: t(`auth.mfa.methodName.${m}`) })}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className="fm-btn-outline w-100"
                    onClick={backToCredentials}
                  >
                    <FaArrowLeft />
                    {t('auth.mfa.back')}
                  </button>
                </div>
              )
            })() : (() => {
              const CodeIcon = method ? MFA_METHOD_ICON[method] : FaShieldAlt
              return (
                <form onSubmit={handleMfaSubmit} className={`fm-mfa-panel${success ? ' is-leaving' : ''}`} key={method}>
                  {dualRequired && (
                    <p className="text-center mb-2">
                      <span className="badge bg-info-subtle text-info-emphasis">
                        {t('auth.mfa.stepIndicator', { stage, total: 2 })}
                      </span>
                    </p>
                  )}
                  <div className="text-center mb-3">
                    <CodeIcon size={28} className="mb-2" />
                    <p className="mb-0 fw-semibold">{t('auth.mfa.title')}</p>
                    <p className="form-text">{t('auth.mfa.description')}</p>
                  </div>
                  <div className="mb-4">
                    <label className="form-label fw-semibold d-block text-center mb-2">{t('auth.mfa.code')}</label>
                    <div className={`fm-mfa-code-boxes${success ? ' is-complete is-leaving' : ''}`}>
                      <CodeInput value={code} onChange={setCode} onComplete={submitMfaCode} disabled={loading || success} autoFocus />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="fm-btn-primary w-100 mb-2"
                    disabled={loading || code.length !== 6}
                  >
                    <CodeIcon />
                    {loading ? t('common.loading') : t('auth.mfa.verify')}
                  </button>
                  {otherMethods.map((m) => {
                    const OtherIcon = MFA_METHOD_ICON[m]
                    return (
                      <button
                        key={m}
                        type="button"
                        className="btn btn-link w-100 mb-2 text-decoration-none"
                        onClick={() => switchMethod(m)}
                        disabled={loading}
                      >
                        <OtherIcon className="me-1" />
                        {t('auth.mfa.switchTo', { method: t(`auth.mfa.methodName.${m}`) })}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className="fm-btn-outline w-100"
                    onClick={backToCredentials}
                    disabled={loading}
                  >
                    <FaArrowLeft />
                    {t('auth.mfa.back')}
                  </button>
                </form>
              )
            })()

            if (retroTheme || dosTheme) {
              return (
                <MfaEasterEgg theme={retroTheme ? 'retro' : 'dos'} onBack={backToCredentials}>
                  {challengeUi}
                </MfaEasterEgg>
              )
            }
            return challengeUi
          })()}
        </div>
      </div>
    </div>
  )
}

export default Login
