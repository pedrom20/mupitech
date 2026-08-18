import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FaUserShield, FaSave } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system } from '@/services/api'
import { showToast } from '@/utils/toast'
import type { EditorCapabilities } from '@/types'

const CAPABILITIES: Array<{ key: keyof EditorCapabilities; labelKey: string; descKey: string }> = [
  { key: 'manage_devices', labelKey: 'editorPermissions.manageDevices', descKey: 'editorPermissions.manageDevicesDesc' },
  { key: 'device_settings', labelKey: 'editorPermissions.deviceSettings', descKey: 'editorPermissions.deviceSettingsDesc' },
  { key: 'power_control', labelKey: 'editorPermissions.powerControl', descKey: 'editorPermissions.powerControlDesc' },
  { key: 'screenshot', labelKey: 'editorPermissions.screenshot', descKey: 'editorPermissions.screenshotDesc' },
  { key: 'branding', labelKey: 'editorPermissions.branding', descKey: 'editorPermissions.brandingDesc' },
  { key: 'image_management', labelKey: 'editorPermissions.imageManagement', descKey: 'editorPermissions.imageManagementDesc' },
  { key: 'credentials', labelKey: 'editorPermissions.credentials', descKey: 'editorPermissions.credentialsDesc' },
  { key: 'sso', labelKey: 'editorPermissions.sso', descKey: 'editorPermissions.ssoDesc' },
]

const EditorPermissionsSettings: React.FC = () => {
  const { t } = useTranslation()
  const [capabilities, setCapabilities] = useState<EditorCapabilities | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    system.getEditorPermissions().then(setCapabilities).catch(() => {})
  }, [])

  const toggle = (key: keyof EditorCapabilities) => {
    if (!capabilities) return
    setCapabilities({ ...capabilities, [key]: !capabilities[key] })
  }

  const handleSave = () => {
    if (!capabilities) return
    setSaving(true)
    system.updateEditorPermissions(capabilities).then((res) => {
      setCapabilities(res)
      showToast('success', t('common.success'))
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setSaving(false))
  }

  return (
    <div className="row g-3">
      <div className="col-12">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaUserShield className="me-2" />
              {t('editorPermissions.title')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-2" style={{ fontSize: '0.8rem' }}>{t('editorPermissions.description')}</p>
            <p className="form-text mb-3" style={{ fontSize: '0.78rem' }}>{t('editorPermissions.simplifiedEditorNote')}</p>

            {!capabilities ? (
              <p className="text-muted">{t('common.loading')}</p>
            ) : (
              <>
                {CAPABILITIES.map(({ key, labelKey, descKey }) => (
                  <div className="form-check form-switch mb-2" key={key}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`editor-cap-${key}`}
                      checked={capabilities[key]}
                      onChange={() => toggle(key)}
                    />
                    <label className="form-check-label" htmlFor={`editor-cap-${key}`}>
                      <span className="fw-semibold d-block">{t(labelKey)}</span>
                      <span className="form-text" style={{ fontSize: '0.78rem' }}>{t(descKey)}</span>
                    </label>
                  </div>
                ))}

                <button className="fm-btn-primary btn-sm mt-2" onClick={handleSave} disabled={saving}>
                  <FaSave />
                  {saving ? t('common.loading') : t('common.save')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditorPermissionsSettings
