import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { FaArrowLeft, FaCheckCircle, FaKey, FaExclamationTriangle } from 'react-icons/fa'
import { auth, ApiError } from '@/services/api'

const ResetPassword: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const uid = searchParams.get('uid') || ''
  const token = searchParams.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const invalidLink = !uid || !token

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError(t('auth.forgotPassword.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      await auth.confirmPasswordReset(uid, token, newPassword)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.forgotPassword.invalidLink'))
    } finally {
      setLoading(false)
    }
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
          {invalidLink ? (
            <div className="text-center">
              <FaExclamationTriangle size={28} className="mb-2 text-warning" />
              <p className="mb-4">{t('auth.forgotPassword.invalidLink')}</p>
              <Link to="/login" className="fm-btn-outline w-100 d-flex align-items-center justify-content-center gap-2">
                <FaArrowLeft />
                {t('auth.forgotPassword.backToLogin')}
              </Link>
            </div>
          ) : success ? (
            <div className="text-center">
              <FaCheckCircle size={28} className="mb-2 text-success" />
              <p className="mb-0">{t('auth.forgotPassword.resetSuccess')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="text-center mb-3">
                <FaKey size={28} className="mb-2" />
                <p className="mb-0 fw-semibold">{t('auth.forgotPassword.resetTitle')}</p>
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold">{t('auth.forgotPassword.newPassword')}</label>
                <input
                  type="password"
                  className="form-control"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                />
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold">{t('auth.forgotPassword.confirmPassword')}</label>
                <input
                  type="password"
                  className="form-control"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              {error && <p className="form-text text-danger mb-3">{error}</p>}
              <button
                type="submit"
                className="fm-btn-primary w-100 mb-2"
                disabled={loading}
              >
                <FaKey />
                {loading ? t('common.loading') : t('auth.forgotPassword.resetSubmit')}
              </button>
              <Link to="/login" className="fm-btn-outline w-100 d-flex align-items-center justify-content-center gap-2">
                <FaArrowLeft />
                {t('auth.forgotPassword.backToLogin')}
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default ResetPassword
