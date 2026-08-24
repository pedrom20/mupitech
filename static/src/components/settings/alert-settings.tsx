import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FaBell, FaSave, FaPaperPlane, FaEye, FaEyeSlash, FaUndo } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system } from '@/services/api'
import { showToast } from '@/utils/toast'
import RichTextEditor from '@/components/shared/rich-text-editor'
import type { AlertSettings as AlertSettingsType } from '@/types'

const AlertSettings: React.FC = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AlertSettingsType | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [thresholdMinutes, setThresholdMinutes] = useState('15')
  const [mode, setMode] = useState<'smtp' | 'graph'>('smtp')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUsername, setSmtpUsername] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [useTls, setUseTls] = useState(true)
  const [fromEmail, setFromEmail] = useState('')
  const [graphTenantId, setGraphTenantId] = useState('')
  const [graphClientId, setGraphClientId] = useState('')
  const [graphClientSecret, setGraphClientSecret] = useState('')
  const [showGraphSecret, setShowGraphSecret] = useState(false)
  const [graphSender, setGraphSender] = useState('')
  const [offlineIntroHtml, setOfflineIntroHtml] = useState('')
  const [editorResetKey, setEditorResetKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingOffline, setTestingOffline] = useState(false)

  useEffect(() => {
    system.getAlertSettings().then((res) => {
      setSettings(res)
      setEnabled(res.enabled)
      setThresholdMinutes(String(res.threshold_minutes))
      setMode(res.mode)
      setSmtpHost(res.smtp_host)
      setSmtpPort(String(res.smtp_port))
      setSmtpUsername(res.smtp_username)
      setUseTls(res.use_tls)
      setFromEmail(res.from_email)
      setGraphTenantId(res.graph_tenant_id)
      setGraphClientId(res.graph_client_id)
      setGraphSender(res.graph_sender)
      setOfflineIntroHtml(res.offline_intro_html || '')
      setEditorResetKey((k) => k + 1)
    }).catch(() => {})
  }, [])

  const isConfigured = mode === 'smtp' ? !!smtpHost : !!(graphTenantId && graphClientId && graphSender)

  const handleSave = () => {
    setSaving(true)
    const data: Record<string, unknown> = {
      enabled,
      threshold_minutes: parseInt(thresholdMinutes, 10) || 15,
      mode,
      smtp_host: smtpHost,
      smtp_port: parseInt(smtpPort, 10) || 587,
      smtp_username: smtpUsername,
      use_tls: useTls,
      from_email: fromEmail,
      graph_tenant_id: graphTenantId,
      graph_client_id: graphClientId,
      graph_sender: graphSender,
      offline_intro_html: offlineIntroHtml,
    }
    if (smtpPassword) {
      data.smtp_password = smtpPassword
    }
    if (graphClientSecret) {
      data.graph_client_secret = graphClientSecret
    }
    system.updateAlertSettings(data).then((res) => {
      setSettings(res)
      setSmtpPassword('')
      setGraphClientSecret('')
      // The server sanitizes offline_intro_html (allowlist-strips any
      // tag/attribute a paste could sneak in) — re-sync so the editor
      // always reflects what's actually stored, not what was typed.
      setOfflineIntroHtml(res.offline_intro_html || '')
      setEditorResetKey((k) => k + 1)
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

  const handleResetIntro = () => {
    setOfflineIntroHtml('')
    setEditorResetKey((k) => k + 1)
  }

  const handleTestOfflineEmail = () => {
    setTestingOffline(true)
    system.sendTestOfflineAlertEmail().then((res) => {
      if (res.success) {
        showToast('success', t('alerts.testSent'))
      } else {
        Swal.fire({ icon: 'error', title: t('common.error'), text: res.error || t('alerts.testFailed') })
      }
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setTestingOffline(false))
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
            <div className="d-flex justify-content-between align-items-center mb-1">
              <p className="fw-semibold mb-0" style={{ fontSize: '0.85rem' }}>{t('alerts.introEditorTitle')}</p>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleResetIntro}
                title={t('alerts.introEditorReset')}
              >
                <FaUndo />
                {t('alerts.introEditorReset')}
              </button>
            </div>
            <p className="form-text mb-2" style={{ fontSize: '0.78rem' }}>{t('alerts.introEditorDesc')}</p>
            <div className="mb-3">
              <RichTextEditor
                key={editorResetKey}
                value={offlineIntroHtml}
                onChange={setOfflineIntroHtml}
                placeholder={t('alerts.introEditorPlaceholder')}
              />
            </div>

            <hr />
            <p className="fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.smtpTitle')}</p>
            <p className="form-text mb-2" style={{ fontSize: '0.78rem' }}>{t('alerts.emailModeDesc')}</p>

            <div className="btn-group btn-group-sm mb-3" role="group">
              <button
                type="button"
                className={`btn ${mode === 'smtp' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setMode('smtp')}
              >
                SMTP
              </button>
              <button
                type="button"
                className={`btn ${mode === 'graph' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setMode('graph')}
              >
                Microsoft Graph
              </button>
            </div>

            {mode === 'smtp' ? (
              <>
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
              </>
            ) : (
              <>
                <p className="form-text mb-2" style={{ fontSize: '0.75rem' }}>{t('alerts.graphDesc')}</p>

                <div className="mb-2">
                  <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.graphTenantId')}</label>
                  <input type="text" className="form-control form-control-sm" value={graphTenantId} onChange={(e) => setGraphTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                </div>

                <div className="mb-2">
                  <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.graphClientId')}</label>
                  <input type="text" className="form-control form-control-sm" value={graphClientId} onChange={(e) => setGraphClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                </div>

                <div className="mb-2">
                  <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.graphClientSecret')}</label>
                  <div className="input-group input-group-sm">
                    <input
                      type={showGraphSecret ? 'text' : 'password'}
                      className="form-control"
                      value={graphClientSecret}
                      onChange={(e) => setGraphClientSecret(e.target.value)}
                      placeholder={settings?.has_graph_client_secret ? '••••••••' : ''}
                    />
                    <button className="btn btn-outline-secondary" type="button" onClick={() => setShowGraphSecret(!showGraphSecret)}>
                      {showGraphSecret ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                  {settings?.has_graph_client_secret && !graphClientSecret && (
                    <div className="form-text text-success" style={{ fontSize: '0.75rem' }}>{t('alerts.passwordSet')}</div>
                  )}
                </div>

                <div className="mb-3">
                  <label className="form-label mb-1" style={{ fontSize: '0.85rem' }}>{t('alerts.graphSender')}</label>
                  <input type="email" className="form-control form-control-sm" value={graphSender} onChange={(e) => setGraphSender(e.target.value)} placeholder="noreply@suaempresa.onmicrosoft.com" />
                  <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('alerts.graphSenderHint')}</div>
                </div>
              </>
            )}

            <div className="d-flex gap-2">
              <button className="fm-btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                <FaSave />
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button className="fm-btn-outline btn-sm" onClick={handleTestEmail} disabled={testing || !isConfigured}>
                <FaPaperPlane />
                {testing ? t('common.loading') : t('alerts.sendTest')}
              </button>
              <button className="fm-btn-outline btn-sm" onClick={handleTestOfflineEmail} disabled={testingOffline || !isConfigured}>
                <FaPaperPlane />
                {testingOffline ? t('common.loading') : t('alerts.sendTestOffline')}
              </button>
            </div>
            <div className="form-text mt-1" style={{ fontSize: '0.75rem' }}>{t('alerts.sendTestOfflineHint')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AlertSettings
