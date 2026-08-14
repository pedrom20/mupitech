import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FaImage, FaUpload, FaTrash, FaPaperPlane, FaFolderOpen } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system } from '@/services/api'
import { showToast } from '@/utils/toast'
import BrandingLibraryPicker from '@/components/shared/branding-library-picker'

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
  const [showLogoPicker, setShowLogoPicker] = useState(false)
  const [showStandbyPicker, setShowStandbyPicker] = useState(false)

  const [showPushAllModal, setShowPushAllModal] = useState(false)
  const [pushAllSshUser, setPushAllSshUser] = useState('pi')
  const [pushAllSshPassword, setPushAllSshPassword] = useState('')
  const [pushAllSshPort, setPushAllSshPort] = useState(22)
  const [pushingAll, setPushingAll] = useState(false)
  const [pushAllTargetLogo, setPushAllTargetLogo] = useState(true)
  const [pushAllTargetStandby, setPushAllTargetStandby] = useState(false)

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

  const uploadLogoFile = async (file: File) => {
    setUploadingLogo(true)
    try {
      const res = await system.uploadBrandingLogo(file)
      setHasLogo(true)
      setLogoUrl(res.logo_url)
      showToast('success', t('common.success'))
      setShowLogoPicker(false)
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.svg') && !name.endsWith('.png') && !name.endsWith('.jpg') && !name.endsWith('.jpeg')) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: t('branding.formatHint') })
      return
    }
    await uploadLogoFile(file)
    if (logoInputRef.current) logoInputRef.current.value = ''
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

  const uploadStandbyFile = async (file: File) => {
    setUploadingStandby(true)
    try {
      const res = await system.uploadBrandingStandby(file)
      setHasStandby(true)
      setStandbyUrl(res.standby_url)
      showToast('success', t('common.success'))
      setShowStandbyPicker(false)
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingStandby(false)
    }
  }

  const handleStandbyChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.png') && !name.endsWith('.jpg') && !name.endsWith('.jpeg') && !name.endsWith('.gif')) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: t('branding.standbyFormatHint') })
      return
    }
    await uploadStandbyFile(file)
    if (standbyInputRef.current) standbyInputRef.current.value = ''
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

  const handlePushAll = async () => {
    if (!pushAllSshPassword || (!pushAllTargetLogo && !pushAllTargetStandby)) return
    setPushingAll(true)
    try {
      const res = await system.pushBrandingToAll(
        pushAllSshUser, pushAllSshPassword, pushAllSshPort,
        pushAllTargetLogo, pushAllTargetStandby,
      )
      const failed = Object.values(res.results).filter((r) => !r.success)
      if (failed.length === 0) {
        Swal.fire({
          icon: 'success',
          title: t('branding.pushed'),
          text: t('branding.pushedAllDesc', { count: Object.keys(res.results).length }),
          timer: 2500,
          showConfirmButton: false,
        })
      } else {
        Swal.fire({
          icon: 'warning',
          title: t('branding.pushPartial'),
          text: failed.map((f) => f.name).join(', '),
        })
      }
      setShowPushAllModal(false)
      setPushAllSshPassword('')
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setPushingAll(false)
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
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="fm-btn-primary btn-sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploadingLogo}
                    >
                      <FaUpload className="me-1" />
                      {uploadingLogo ? t('common.loading') : t('branding.upload')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setShowLogoPicker(true)}
                    >
                      <FaFolderOpen className="me-1" />
                      {t('brandingLibrary.chooseButton')}
                    </button>
                  </div>
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
              <p className="text-muted mb-1" style={{ fontSize: '0.78rem' }}>{t('branding.standbyDescription')}</p>
              <p className="text-muted mb-2" style={{ fontSize: '0.72rem' }}>{t('branding.standbyGifHint')}</p>
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
                    accept=".png,image/png,.jpg,.jpeg,image/jpeg,.gif,image/gif"
                    className="d-none"
                    onChange={handleStandbyChange}
                  />
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="fm-btn-primary btn-sm"
                      onClick={() => standbyInputRef.current?.click()}
                      disabled={uploadingStandby}
                    >
                      <FaUpload className="me-1" />
                      {uploadingStandby ? t('common.loading') : t('branding.upload')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setShowStandbyPicker(true)}
                    >
                      <FaFolderOpen className="me-1" />
                      {t('brandingLibrary.chooseButton')}
                    </button>
                  </div>
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

        <p className="text-muted mt-3 mb-2" style={{ fontSize: '0.78rem' }}>
          {t('branding.pushHint')}
        </p>
        <button type="button" className="fm-btn-outline btn-sm" onClick={() => setShowPushAllModal(true)}>
          <FaPaperPlane className="me-1" />
          {t('branding.pushAllTitle')}
        </button>
      </div>

      {showPushAllModal && (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowPushAllModal(false)}
        >
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">{t('branding.pushAllTitle')}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowPushAllModal(false)}
                  aria-label={t('common.close')}
                />
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('branding.pushAllDesc')}</p>
                <div className="mb-3">
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="push-all-target-logo"
                      checked={pushAllTargetLogo}
                      onChange={(e) => setPushAllTargetLogo(e.target.checked)}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="push-all-target-logo">
                      {t('branding.logoLabel')}
                    </label>
                  </div>
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="push-all-target-standby"
                      checked={pushAllTargetStandby}
                      onChange={(e) => setPushAllTargetStandby(e.target.checked)}
                      disabled={!hasStandby}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="push-all-target-standby">
                      {t('branding.standbyLabel')}
                      {!hasStandby && (
                        <span className="text-muted"> ({t('branding.notSet')})</span>
                      )}
                    </label>
                  </div>
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshUser')}</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={pushAllSshUser}
                    onChange={(e) => setPushAllSshUser(e.target.value)}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshPassword')}</label>
                  <input
                    type="password"
                    className="form-control form-control-sm"
                    value={pushAllSshPassword}
                    onChange={(e) => setPushAllSshPassword(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshPort')}</label>
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    value={pushAllSshPort}
                    onChange={(e) => setPushAllSshPort(Number(e.target.value))}
                    min={1}
                    max={65535}
                    style={{ maxWidth: '120px' }}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPushAllModal(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="fm-btn-primary"
                  onClick={handlePushAll}
                  disabled={pushingAll || !pushAllSshPassword || (!pushAllTargetLogo && !pushAllTargetStandby)}
                >
                  {pushingAll ? t('common.loading') : t('branding.push')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BrandingLibraryPicker
        kind="logo"
        show={showLogoPicker}
        onClose={() => setShowLogoPicker(false)}
        onPick={uploadLogoFile}
      />
      <BrandingLibraryPicker
        kind="standby"
        show={showStandbyPicker}
        onClose={() => setShowStandbyPicker(false)}
        onPick={uploadStandbyFile}
      />
    </div>
  )
}

export default BrandingSettings
