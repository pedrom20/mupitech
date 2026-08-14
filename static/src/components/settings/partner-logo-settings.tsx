import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FaBuilding, FaUpload, FaTrash } from 'react-icons/fa'
import { system } from '@/services/api'
import { showToast } from '@/utils/toast'

// Distinct from BrandingSettings (device-facing splash/standby images):
// this is the Fleet Manager's OWN navbar, showing an optional partner/
// reseller logo next to the MupiTech wordmark ("MupiTech | [logo]").
const PartnerLogoSettings: React.FC = () => {
  const { t } = useTranslation()
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    system.getTheme()
      .then((res) => setLogoUrl(res.partner_logo_url))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await system.uploadPartnerLogo(file)
      setLogoUrl(res.partner_logo_url)
      showToast('success', t('partnerLogo.uploaded'))
    } catch (err) {
      showToast('error', t('common.error'), String(err))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDelete = async () => {
    try {
      await system.deletePartnerLogo()
      setLogoUrl(null)
      showToast('success', t('partnerLogo.removed'))
    } catch (err) {
      showToast('error', t('common.error'), String(err))
    }
  }

  return (
    <div className="fm-card fm-card-accent h-100">
      <div className="fm-card-header py-2 d-flex justify-content-between align-items-center">
        <h5 className="card-title mb-0">
          <FaBuilding className="me-2" />
          {t('partnerLogo.title')}
        </h5>
      </div>
      <div className="fm-card-body py-3">
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('partnerLogo.description')}</p>

        {loading ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : (
          <div className="d-flex flex-column gap-2">
            <div
              className="border rounded d-flex align-items-center justify-content-center p-2"
              style={{ width: '100%', height: '90px', background: 'var(--bs-tertiary-bg, #f5f5f5)' }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Partner logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
              ) : (
                <span className="text-muted" style={{ fontSize: '0.8rem' }}>{t('partnerLogo.none')}</span>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
              className="d-none"
              onChange={handleChange}
            />
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                <FaUpload className="me-1" />
                {uploading ? t('common.loading') : t('partnerLogo.upload')}
              </button>
              {logoUrl && (
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={handleDelete}>
                  <FaTrash className="me-1" />
                  {t('common.remove')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PartnerLogoSettings
