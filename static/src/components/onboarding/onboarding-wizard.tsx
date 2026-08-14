import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaKey, FaShieldAlt } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { AuthContext } from '@/components/app'
import { users as usersApi, ApiError } from '@/services/api'
import SecuritySettings from '@/components/settings/security-settings'

const MFA_POLL_INTERVAL_MS = 3000

/** Blocks the rest of the app behind a forced first-login checklist —
 * password change and/or MFA enrollment — set per-user at creation time
 * (see users-settings.tsx). Re-derives which step to show directly from
 * the current user's flags on every render rather than owning its own
 * step state, so it self-corrects (and unmounts) the moment AuthContext
 * refreshes with both flags cleared — no explicit "finish" action needed. */
const OnboardingWizard: React.FC = () => {
  const { t } = useTranslation()
  const { user, refresh } = useContext(AuthContext)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const needsPasswordChange = !!user?.must_change_password
  const needsMfaEnroll = !!user?.force_mfa_enroll
  const step = needsPasswordChange ? 'password' : 'mfa'

  useEffect(() => {
    if (step !== 'mfa' || !needsMfaEnroll) return
    const interval = setInterval(refresh, MFA_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, needsMfaEnroll])

  if (!user) return null

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: t('onboarding.passwordMismatch') })
      return
    }
    setSaving(true)
    try {
      await usersApi.changeOwnPassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      refresh()
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('onboarding.passwordChangeError'),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="d-flex justify-content-center align-items-start" style={{ minHeight: '60vh', paddingTop: '3rem' }}>
      <div style={{ maxWidth: '640px', width: '100%' }}>
        <div className="text-center mb-4">
          <h2 className="mb-1">{t('onboarding.title')}</h2>
          <p className="text-muted">{t('onboarding.subtitle')}</p>
        </div>

        {step === 'password' && (
          <div className="fm-card fm-card-accent">
            <div className="fm-card-header py-2">
              <h5 className="card-title mb-0">
                <FaKey className="me-2" />
                {t('onboarding.passwordStepTitle')}
              </h5>
            </div>
            <div className="fm-card-body py-3">
              <p className="form-text mb-3" style={{ fontSize: '0.85rem' }}>{t('onboarding.passwordStepHint')}</p>
              <form onSubmit={handlePasswordSubmit}>
                <div className="mb-3">
                  <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                    {t('onboarding.currentPassword')}
                  </label>
                  <input
                    type="password"
                    className="form-control"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                    {t('onboarding.newPassword')}
                  </label>
                  <input
                    type="password"
                    className="form-control"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                    {t('onboarding.confirmPassword')}
                  </label>
                  <input
                    type="password"
                    className="form-control"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <button type="submit" className="fm-btn-primary w-100" disabled={saving}>
                  {saving ? t('common.loading') : t('onboarding.continueButton')}
                </button>
              </form>
            </div>
          </div>
        )}

        {step === 'mfa' && (
          <>
            <div className="text-center mb-3">
              <FaShieldAlt size={22} className="mb-1" />
              <p className="form-text mb-0" style={{ fontSize: '0.85rem' }}>{t('onboarding.mfaStepHint')}</p>
            </div>
            <SecuritySettings />
          </>
        )}
      </div>
    </div>
  )
}

export default OnboardingWizard
