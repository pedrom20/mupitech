import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FaBell, FaSave, FaPaperPlane, FaEye, FaEyeSlash } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system } from '@/services/api'
import { showToast } from '@/utils/toast'
import type { AlertSettings as AlertSettingsType } from '@/types'

const AlertSettings: React.FC = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AlertSettingsType | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [thresholdMinutes, setThresholdMinutes] = useState('15')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUsername, setSmtpUsername] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [useTls, setUseTls] = useState(true)
  const [fromEmail, setFromEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    system.getAlertSettings().then((res) => {
      setSettings(res)
      setEnabled(res.enabled)
      setThresholdMinutes(String(res.threshold_minutes))
      setSmtpHost(res.smtp_host)
      setSmtpPort(String(res.smtp_port))
      setSmtpUsername(res.smtp_username)
      setUseTls(res.use_tls)
      setFromEmail(res.from_email)
    }).catch(() => {})
  }, [])

  const handleSave = () => {
    setSaving(true)
    const data: Record<string, unknown> = {
      enabled,
      threshold_minutes: parseInt(thresholdMinutes, 10) || 15,
      smtp_host: smtpHost,
      smtp_port: parseInt(smtpPort, 10) || 587,
      smtp_username: smtpUsername,
      use_tls: useTls,
      from_email: fromEmail,
    }
    if (smtpPassword) {
      data.smtp_password = smtpPassword
    }
    system.updateAlertSettings(data).then((res) => {
      setSettings(res)
      setSmtpPassword('')
      showToast('success', t('common.success'))
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setSaving(false))
  }

  const handleTestEmail = () => {
    setTesting(true)
    system.sendTestAlertEmail().then((res) => {
      if (res.success) {
        showToast('success', t('alerts.testSent'))
      } else {
        Swal.fire({ icon: 'error', title: t('common.error'), text: res.error || t('alerts.testFailed') })
      }
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setTesting(false))
  }

  return (
    <div className="row g-3">
      <div className="col-12">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaBell className="me-2" />
              {t('alerts.title')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-2" style={{ fontSize: '0.8rem' }}>{t('alerts.description')}</p>

            <div className="form-check form-switch mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                id="alerts-enable"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <label className="form-check-label fw-semibold" htmlFor="alerts-enable">
                {t('alerts.enable')}
              </label>
            </div>

            <div className="mb-3">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.threshold')}</label>
              <div className="input-group input-group-sm" style={{ maxWidth: '200px' }}>
                <input
                  type="number"
                  className="form-control"
                  min={1}
                  value={thresholdMinutes}
                  onChange={(e) => setThresholdMinutes(e.target.value)}
                />
                <span className="input-group-text">{t('settings.minutes')}</span>
              </div>
              <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('alerts.thresholdDesc')}</div>
            </div>

            <hr />
            <p className="fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>{t('alerts.smtpTitle')}</p>

            <div className="row g-2 mb-2">
              <div className="col-8">
                <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.smtpHost')}</label>
                <input type="text" className="form-control form-control-sm" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
              </div>
              <div className="col-4">
                <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.smtpPort')}</label>
                <input type="number" className="form-control form-control-sm" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
              </div>
            </div>

            <div className="mb-2">
              <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.smtpUsername')}</label>
              <input type="text" className="form-control form-control-sm" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} />
            </div>

            <div className="mb-2">
              <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.smtpPassword')}</label>
              <div className="input-group input-group-sm">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={settings?.has_password ? '••••••••' : ''}
                />
                <button className="btn btn-outline-secondary" type="button" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {settings?.has_password && !smtpPassword && (
                <div className="form-text text-success" style={{ fontSize: '0.75rem' }}>{t('alerts.passwordSet')}</div>
              )}
            </div>

            <div className="mb-2">
              <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.fromEmail')}</label>
              <input type="email" className="form-control form-control-sm" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder={smtpUsername} />
            </div>

            <div className="form-check form-switch mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                id="alerts-tls"
                checked={useTls}
                onChange={(e) => setUseTls(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="alerts-tls">{t('alerts.useTls')}</label>
            </div>

            <div className="d-flex gap-2">
              <button className="fm-btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                <FaSave />
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button className="fm-btn-outline btn-sm" onClick={handleTestEmail} disabled={testing || !smtpHost}>
                <FaPaperPlane />
                {testing ? t('common.loading') : t('alerts.sendTest')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AlertSettings
