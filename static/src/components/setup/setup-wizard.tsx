import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaUserShield, FaBuilding, FaCheckCircle, FaArrowRight } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system, ApiError } from '@/services/api'
import PartnerLogoSettings from '@/components/settings/partner-logo-settings'

interface Props {
  /** Called once the wizard is fully done (admin created, branding step
   * dismissed either way) — App re-runs its own auth check so the
   * normal Routes tree takes over. */
  onComplete: () => void
}

/** First-run bootstrap: a brand-new install has zero users and nothing
 * that creates one on its own (see fleet_manager/system_views.py::
 * run_setup's module comment) — this is what stands in for
 * `manage.py createsuperuser` for anyone not comfortable shelling into
 * the container. Local step state, not derived from user flags like
 * OnboardingWizard — there's no persistent "still needs branding" field
 * on the account, this is purely a one-time flow the user can dismiss
 * at the branding step. */
const SetupWizard: React.FC<Props> = ({ onComplete }) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<'admin' | 'branding'>('admin')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: t('setupWizard.passwordMismatch') })
      return
    }
    setSaving(true)
    try {
      await system.runSetup({ username, password, email: email || undefined })
      setStep('branding')
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('setupWizard.createError'),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="d-flex justify-content-center align-items-start" style={{ minHeight: '60vh', paddingTop: '3rem' }}>
      <div style={{ maxWidth: '640px', width: '100%' }}>
        <div className="text-center mb-4">
          <h2 className="mb-1">{t('setupWizard.title')}</h2>
          <p className="text-muted">{t('setupWizard.subtitle')}</p>
        </div>

        {step === 'admin' && (
          <div className="fm-card fm-card-accent">
            <div className="fm-card-header py-2">
              <h5 className="card-title mb-0">
                <FaUserShield className="me-2" />
                {t('setupWizard.adminStepTitle')}
              </h5>
            </div>
            <div className="fm-card-body py-3">
              <p className="form-text mb-3" style={{ fontSize: '0.85rem' }}>{t('setupWizard.adminStepHint')}</p>
              <form onSubmit={handleAdminSubmit}>
                <div className="mb-3">
                  <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                    {t('auth.username')}
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    minLength={3}
                    autoFocus
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                    {t('setupWizard.emailOptional')}
                  </label>
                  <input
                    type="email"
                    className="form-control"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                    {t('auth.password')}
                  </label>
                  <input
                    type="password"
                    className="form-control"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
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
                    minLength={8}
                  />
                </div>
                <button type="submit" className="fm-btn-primary w-100" disabled={saving}>
                  {saving ? t('common.loading') : t('setupWizard.continueButton')}
                </button>
              </form>
            </div>
          </div>
        )}

        {step === 'branding' && (
          <>
            <div className="text-center mb-3">
              <FaBuilding size={22} className="mb-1" />
              <p className="form-text mb-0" style={{ fontSize: '0.85rem' }}>{t('setupWizard.brandingStepHint')}</p>
            </div>
            <PartnerLogoSettings />
            <button type="button" className="fm-btn-primary w-100 mt-3" onClick={onComplete}>
              <FaCheckCircle className="me-1" />
              {t('setupWizard.finishButton')}
              <FaArrowRight className="ms-1" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default SetupWizard
