import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FaImage, FaUpload, FaTrash } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system } from '@/services/api'

const BrandingSettings: React.FC = () => {
  const { t } = useTranslation()
  const [hasLogo, setHasLogo] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    system.getBranding()
      .then((res) => { setHasLogo(res.has_custom_logo); setLogoUrl(res.logo_url) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.svg') && !name.endsWith('.png') && !name.endsWith('.jpg') && !name.endsWith('.jpeg')) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: t('branding.formatHint') })
      return
    }
    setUploading(true)
    try {
      const res = await system.uploadBrandingLogo(file)
      setHasLogo(true)
      setLogoUrl(res.logo_url)
      Swal.fire({ icon: 'success', title: t('common.success'), timer: 1500, showConfirmButton: false })
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async () => {
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('branding.confirmDelete'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    try {
      await system.deleteBrandingLogo()
      load()
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  return (
    <div className="fm-card fm-card-accent h-100">
      <div className="fm-card-header py-2 d-flex justify-content-between align-items-center">
        <h5 className="card-title mb-0">
          <FaImage className="me-2" />
          {t('branding.title')}
        </h5>
      </div>
      <div className="fm-card-body py-3">
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('branding.description')}</p>

        {loading ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : (
          <div className="d-flex align-items-center gap-3">
            <div
              className="border rounded d-flex align-items-center justify-content-center p-2"
              style={{ width: '160px', height: '90px', background: 'var(--bs-tertiary-bg, #f5f5f5)', flexShrink: 0 }}
            >
              {logoUrl && (
                <img src={logoUrl} alt="Splash logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
              )}
            </div>
            <div className="d-flex flex-column gap-2">
              <span className="badge bg-light text-muted border align-self-start" style={{ fontSize: '0.7rem' }}>
                {hasLogo ? t('branding.customSet') : t('branding.usingDefault')}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
                className="d-none"
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="fm-btn-primary btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <FaUpload className="me-1" />
                {uploading ? t('common.loading') : t('branding.upload')}
              </button>
              {hasLogo && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleDelete}>
                  <FaTrash className="me-1" />
                  {t('branding.revertToDefault')}
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-muted mt-3 mb-0" style={{ fontSize: '0.78rem' }}>
          {t('branding.pushHint')}
        </p>
      </div>
    </div>
  )
}

export default BrandingSettings
