import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { FaSignInAlt, FaArrowLeft, FaShieldAlt, FaMobileAlt } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { AuthContext } from '@/components/app'
import { auth, ApiError } from '@/services/api'
import CodeInput from '@/components/shared/code-input'

const Login: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { refresh } = useContext(AuthContext)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // Second factor: only entered once the first factor comes back with
  // mfa_required — no session exists yet at that point.
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [method, setMethod] = useState<'totp' | 'duo' | null>(null)
  const [code, setCode] = useState('')
  const [duoStatus, setDuoStatus] = useState<'pending' | 'timeout' | 'error'>('pending')
  const [duoError, setDuoError] = useState('')

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await auth.login(username, password)
      if ('mfa_required' in result) {
        setChallengeId(result.challenge_id)
        setMethod(result.method)
      } else {
        refresh()
        navigate('/')
      }
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

  const submitMfaCode = async (submittedCode: string) => {
    if (!challengeId || submittedCode.length !== 6) return
    setLoading(true)
    try {
      await auth.verifyMfa(challengeId, submittedCode)
      refresh()
      navigate('/')
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

  const sendDuoPush = async (challenge: string) => {
    setDuoStatus('pending')
    setDuoError('')
    try {
      await auth.verifyDuo(challenge)
      refresh()
      navigate('/')
    } catch (error) {
      if (error instanceof ApiError && error.message === 'timeout') {
        setDuoStatus('timeout')
      } else {
        setDuoStatus('error')
        setDuoError(error instanceof ApiError ? error.message : String(error))
      }
    }
  }

  useEffect(() => {
    if (challengeId && method === 'duo') {
      sendDuoPush(challengeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, method])

  const backToCredentials = () => {
    setChallengeId(null)
    setMethod(null)
    setCode('')
    setDuoStatus('pending')
    setDuoError('')
  }

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
          ) : method === 'duo' ? (
            <div>
              <div className="text-center mb-4">
                <FaMobileAlt size={28} className="mb-2" />
                <p className="mb-0 fw-semibold">{t('auth.duo.title')}</p>
                {duoStatus === 'pending' && (
                  <p className="form-text">
                    <span className="spinner-border spinner-border-sm me-2" />
                    {t('auth.duo.waiting')}
                  </p>
                )}
                {duoStatus === 'timeout' && (
                  <p className="form-text text-warning">{t('auth.duo.timeout')}</p>
                )}
                {duoStatus === 'error' && (
                  <p className="form-text text-danger">{duoError || t('auth.duo.denied')}</p>
                )}
              </div>
              {duoStatus !== 'pending' && (
                <button
                  type="button"
                  className="fm-btn-primary w-100 mb-2"
                  onClick={() => challengeId && sendDuoPush(challengeId)}
                >
                  <FaMobileAlt />
                  {t('auth.duo.retry')}
                </button>
              )}
              <button
                type="button"
                className="fm-btn-outline w-100"
                onClick={backToCredentials}
              >
                <FaArrowLeft />
                {t('auth.mfa.back')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleMfaSubmit}>
              <div className="text-center mb-3">
                <FaShieldAlt size={28} className="mb-2" />
                <p className="mb-0 fw-semibold">{t('auth.mfa.title')}</p>
                <p className="form-text">{t('auth.mfa.description')}</p>
              </div>
              <div className="mb-4">
                <label className="form-label fw-semibold d-block text-center mb-2">{t('auth.mfa.code')}</label>
                <CodeInput value={code} onChange={setCode} onComplete={submitMfaCode} disabled={loading} autoFocus />
              </div>
              <button
                type="submit"
                className="fm-btn-primary w-100 mb-2"
                disabled={loading || code.length !== 6}
              >
                <FaShieldAlt />
                {loading ? t('common.loading') : t('auth.mfa.verify')}
              </button>
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
          )}
        </div>
      </div>
    </div>
  )
}

export default Login
