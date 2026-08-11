import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaTrash, FaUpload, FaCheck } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { brandingLibrary, type BrandingImage } from '@/services/api'

interface BrandingLibraryPickerProps {
  kind: 'logo' | 'standby'
  show: boolean
  onClose: () => void
  /** Called with the picked (or freshly uploaded) image as a File, so the
   * caller can feed it into whatever upload/apply flow it already has
   * (fleet-wide, group, location or device branding) without this
   * component needing to know about any of them. */
  onPick: (file: File) => void
}

/** Reusable "pick from library, or upload a new one (which also saves to
 * the library)" modal — used wherever a splash logo or standby image can
 * be set, so images don't have to be re-uploaded from scratch every time. */
const BrandingLibraryPicker: React.FC<BrandingLibraryPickerProps> = ({ kind, show, onClose, onPick }) => {
  const { t } = useTranslation()
  const [images, setImages] = useState<BrandingImage[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pickingId, setPickingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!show) return
    setLoading(true)
    brandingLibrary.list(kind).then(setImages).catch(() => setImages([])).finally(() => setLoading(false))
  }, [show, kind])

  if (!show) return null

  const handleUploadNew = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const created = await brandingLibrary.upload(kind, file, file.name)
      setImages((prev) => [created, ...prev])
      onPick(file)
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handlePick = async (image: BrandingImage) => {
    setPickingId(image.id)
    try {
      const blob = await fetch(image.file).then((r) => r.blob())
      const file = new File([blob], image.name, { type: blob.type })
      onPick(file)
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setPickingId(null)
    }
  }

  const handleDelete = async (image: BrandingImage, e: React.MouseEvent) => {
    e.stopPropagation()
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('brandingLibrary.confirmDelete', { name: image.name }),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    try {
      await brandingLibrary.delete(image.id)
      setImages((prev) => prev.filter((i) => i.id !== image.id))
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title fw-bold">
              {kind === 'logo' ? t('brandingLibrary.titleLogo') : t('brandingLibrary.titleStandby')}
            </h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label={t('common.close')} />
          </div>
          <div className="modal-body">
            <input
              ref={fileInputRef}
              type="file"
              accept={kind === 'logo' ? '.svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg' : '.png,image/png,.jpg,.jpeg,image/jpeg'}
              className="d-none"
              onChange={handleUploadNew}
            />
            <button
              type="button"
              className="fm-btn-primary btn-sm mb-3"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <FaUpload className="me-1" />
              {uploading ? t('common.loading') : t('brandingLibrary.uploadNew')}
            </button>

            {loading ? (
              <p className="text-muted">{t('common.loading')}</p>
            ) : images.length === 0 ? (
              <p className="text-muted">{t('brandingLibrary.empty')}</p>
            ) : (
              <div className="row g-2">
                {images.map((image) => (
                  <div key={image.id} className="col-6 col-md-4 col-lg-3">
                    <div
                      className="card h-100"
                      style={{ cursor: pickingId ? 'wait' : 'pointer', opacity: pickingId && pickingId !== image.id ? 0.6 : 1 }}
                      onClick={() => !pickingId && handlePick(image)}
                    >
                      <div
                        className="d-flex align-items-center justify-content-center"
                        style={{ height: '80px', background: kind === 'standby' ? '#000' : 'var(--bs-tertiary-bg, #f5f5f5)', borderRadius: '6px 6px 0 0', overflow: 'hidden' }}
                      >
                        <img src={image.file} alt={image.name} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                      </div>
                      <div className="card-body p-2 d-flex align-items-center justify-content-between gap-1">
                        <small className="text-truncate" title={image.name}>{image.name}</small>
                        <div className="d-flex align-items-center gap-1 flex-shrink-0">
                          {pickingId === image.id ? (
                            <span className="spinner-border spinner-border-sm" />
                          ) : (
                            <FaCheck className="text-success" style={{ fontSize: '0.75rem' }} />
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-link p-0 text-danger"
                            onClick={(e) => handleDelete(image, e)}
                          >
                            <FaTrash style={{ fontSize: '0.75rem' }} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default BrandingLibraryPicker
