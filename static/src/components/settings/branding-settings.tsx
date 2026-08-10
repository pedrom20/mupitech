import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FaImage, FaUpload, FaTrash } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system } from '@/services/api'

const BrandingSettings: React.FC = () => {
  const { t } = useTranslation()
  const [hasLogo, setHasLogo] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [hasStandby, setHasStandby] = useState(false)
  const [standbyUrl, setStandbyUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingStandby, setUploadingStandby] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const standbyInputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    system.getBranding()
      .then((res) => {
        setHasLogo(res.has_custom_logo)
        setLogoUrl(res.logo_url)
        setHasStandby(res.has_standby_image)
        setStandbyUrl(res.standby_url)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.svg') && !name.endsWith('.png') && !name.endsWith('.jpg') && !name.endsWith('.jpeg')) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: t('branding.formatHint') })
      return
    }
    setUploadingLogo(true)
    try {
      const res = await system.uploadBrandingLogo(file)
      setHasLogo(true)
      setLogoUrl(res.logo_url)
      Swal.fire({ icon: 'success', title: t('common.success'), timer: 1500, showConfirmButton: false })
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingLogo(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  const handleLogoDelete = async () => {
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

  const handleStandbyChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.png') && !name.endsWith('.jpg') && !name.endsWith('.jpeg')) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: t('branding.standbyFormatHint') })
      return
    }
    setUploadingStandby(true)
    try {
      const res = await system.uploadBrandingStandby(file)
      setHasStandby(true)
      setStandbyUrl(res.standby_url)
      Swal.fire({ icon: 'success', title: t('common.success'), timer: 1500, showConfirmButton: false })
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingStandby(false)
      if (standbyInputRef.current) standbyInputRef.current.value = ''
    }
  }

  const handleStandbyDelete = async () => {
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('branding.confirmDeleteStandby'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    try {
      await system.deleteBrandingStandby()
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
          <div className="d-flex flex-column gap-4">
            {/* Splash logo (network/IP screen) */}
            <div>
              <label className="form-label fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>{t('branding.logoLabel')}</label>
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
                    ref={logoInputRef}
                    type="file"
                    accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
                    className="d-none"
                    onChange={handleLogoChange}
                  />
                  <button
                    type="button"
                    className="fm-btn-primary btn-sm"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                  >
                    <FaUpload className="me-1" />
                    {uploadingLogo ? t('common.loading') : t('branding.upload')}
                  </button>
                  {hasLogo && (
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleLogoDelete}>
                      <FaTrash className="me-1" />
                      {t('branding.revertToDefault')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Standby image (no content playing) */}
            <div>
              <label className="form-label fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>{t('branding.standbyLabel')}</label>
              <p className="text-muted mb-2" style={{ fontSize: '0.78rem' }}>{t('branding.standbyDescription')}</p>
              <div className="d-flex align-items-center gap-3">
                <div
                  className="border rounded d-flex align-items-center justify-content-center p-2"
                  style={{ width: '160px', height: '90px', background: '#000', flexShrink: 0 }}
                >
                  {standbyUrl && (
                    <img src={standbyUrl} alt="Standby image" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                  )}
                </div>
                <div className="d-flex flex-column gap-2">
                  <span className="badge bg-light text-muted border align-self-start" style={{ fontSize: '0.7rem' }}>
                    {hasStandby ? t('branding.customSet') : t('branding.notSet')}
                  </span>
                  <input
                    ref={standbyInputRef}
                    type="file"
                    accept=".png,image/png,.jpg,.jpeg,image/jpeg"
                    className="d-none"
                    onChange={handleStandbyChange}
                  />
                  <button
                    type="button"
                    className="fm-btn-primary btn-sm"
                    onClick={() => standbyInputRef.current?.click()}
                    disabled={uploadingStandby}
                  >
                    <FaUpload className="me-1" />
                    {uploadingStandby ? t('common.loading') : t('branding.upload')}
                  </button>
                  {hasStandby && (
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleStandbyDelete}>
                      <FaTrash className="me-1" />
                      {t('common.delete')}
                    </button>
                  )}
                </div>
              </div>
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
