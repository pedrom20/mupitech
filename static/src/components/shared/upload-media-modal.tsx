import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaCloudUploadAlt, FaTimes } from 'react-icons/fa'

/** Minimal file-upload-only modal — the dropzone/picker half of
 * deploy-form.tsx's AddContentModal, lifted out as its own component so
 * other pages (e.g. playlist-list.tsx) can offer "upload a new file"
 * without pulling in that modal's URL/Apps/CCTV tabs, which are specific
 * to the Content page. Purely a trigger: the actual upload loop (and its
 * own progress/notification handling) stays with whoever renders this. */
const UploadMediaModal: React.FC<{
  show: boolean
  onClose: () => void
  onUpload: (files: FileList | null) => void
}> = ({ show, onClose, onUpload }) => {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!show) return null

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: '12px', overflow: 'hidden' }}>
          <div className="modal-header py-2 px-3">
            <h6 className="modal-title mb-0">
              <FaCloudUploadAlt className="me-2" />
              {t('content.tabFile')}
            </h6>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body p-3">
            <div
              className={`border border-2 border-dashed rounded p-4 text-center ${dragOver ? 'border-primary bg-light' : 'border-secondary'}`}
              style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                onUpload(e.dataTransfer.files)
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <FaCloudUploadAlt size={32} className="text-muted mb-2" />
              <p className="mb-1 fw-medium">
                {dragOver ? t('content.dropzoneActive') : t('content.dropzone')}
              </p>
              <small className="text-muted">{t('content.supportedFormats')}</small>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                onUpload(e.target.files)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />
          </div>
          <div className="modal-footer py-2">
            <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
              <FaTimes /> {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UploadMediaModal
