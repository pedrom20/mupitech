import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FaImage, FaVideo, FaGlobe, FaFile, FaPlay, FaExternalLinkAlt } from 'react-icons/fa'
import { cctv as cctvApi } from '@/services/api'
import type { MediaFile } from '@/types'

/** Small floating preview shown while hovering a file row/tile — pass
 * the hovered file and its tile's getBoundingClientRect(). position:
 * fixed with viewport coordinates, so it isn't clipped by a scrolling
 * ancestor (e.g. a modal body), same as every existing caller relies
 * on. Caller owns the hover/mouseleave timing (hoveredFile/hoverRect
 * state + a leave timeout) — this component only renders. */
export function FileHoverPreview({ file, rect }: { file: MediaFile; rect: DOMRect }) {
  const { t } = useTranslation()
  const f = file
  return (
    <div
      style={{
        position: 'fixed',
        left: Math.min(rect.left, window.innerWidth - 320),
        top: rect.bottom + 8 + 230 > window.innerHeight
          ? rect.top - 8 - 240
          : rect.bottom + 8,
        zIndex: 10000,
        width: '300px',
        pointerEvents: 'none',
      }}
    >
      <div
        className="shadow-lg"
        style={{
          background: 'var(--bs-body-bg, #fff)',
          border: '1px solid var(--bs-border-color, #dee2e6)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        {/* Preview content */}
        {f.file_type === 'video' && f.file ? (
          f.thumbnail_file_url ? (
            <img
              src={f.thumbnail_file_url}
              alt={f.name}
              style={{ width: '100%', height: '170px', objectFit: 'cover', display: 'block', background: '#000' }}
            />
          ) : (
            <video
              src={f.url}
              autoPlay
              muted
              loop
              playsInline
              style={{ width: '100%', height: '170px', objectFit: 'cover', display: 'block', background: '#000' }}
            />
          )
        ) : f.file_type === 'image' && f.file ? (
          <img
            src={f.thumbnail_file_url || f.url}
            alt={f.name}
            style={{ width: '100%', height: '170px', objectFit: 'cover', display: 'block', background: '#000' }}
          />
        ) : f.file_type === 'web' && f.source_url ? (
          <div
            style={{
              width: '100%',
              height: '170px',
              background: 'linear-gradient(135deg, #e8f4fd 0%, #d0e8f7 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {f.thumbnail_url ? (
              <img src={f.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <>
                <img
                  src={`https://www.google.com/s2/favicons?domain=${getDomain(f.source_url)}&sz=64`}
                  alt=""
                  style={{ width: '48px', height: '48px', marginBottom: '8px' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                <small className="text-muted px-3 text-center" style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                  {getDomain(f.source_url)}
                </small>
              </>
            )}
          </div>
        ) : f.file_type === 'cctv' ? (
          <div
            style={{
              width: '100%',
              height: '170px',
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {f.thumbnail_file_url ? (
              <img src={f.thumbnail_file_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <FaVideo style={{ fontSize: '2.5rem', color: '#dc3545' }} />
            )}
          </div>
        ) : (
          <div
            className="d-flex flex-column align-items-center justify-content-center"
            style={{
              width: '100%',
              height: '170px',
              background: 'var(--bs-gray-200, #e9ecef)',
              color: 'var(--bs-gray-500, #adb5bd)',
              fontSize: '2.5rem',
            }}
          >
            <FileTypeIcon type={f.file_type} />
            <small className="mt-2" style={{ fontSize: '0.7rem' }}>
              {t('content.noPreview')}
            </small>
          </div>
        )}
        {/* Info footer */}
        <div className="p-2">
          <div className="fw-semibold mb-1" style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>
            {f.name}
          </div>
          <div className="d-flex gap-3 text-muted" style={{ fontSize: '0.75rem' }}>
            <span className="d-inline-flex align-items-center gap-1">
              <FileTypeIcon type={f.file_type} />
              {f.file_type.charAt(0).toUpperCase() + f.file_type.slice(1)}
            </span>
            {f.file_size > 0 && <span>{formatFileSize(f.file_size)}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']

export function isImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext))
  } catch {
    return false
  }
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function FileTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'image':
      return <FaImage />
    case 'video':
      return <FaVideo />
    case 'web':
      return <FaGlobe />
    case 'cctv':
      return <FaVideo />
    default:
      return <FaFile />
  }
}

export function FilePreview({ file }: { file: MediaFile }) {
  const thumbUrl = file.thumbnail_file_url
  const thumbStyle: React.CSSProperties = {
    width: '100%',
    aspectRatio: '16/9',
    objectFit: 'cover',
    borderRadius: '6px 6px 0 0',
    display: 'block',
  }
  if (file.file_type === 'cctv') {
    return (
      <div style={{ position: 'relative' }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt={file.name} style={thumbStyle} />
        ) : (
          <div
            className="d-flex flex-column align-items-center justify-content-center"
            style={{
              width: '100%',
              aspectRatio: '16/9',
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
              borderRadius: '6px 6px 0 0',
            }}
          >
            <FaVideo style={{ fontSize: '2.5rem', color: '#dc3545', opacity: 0.8 }} />
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: 'rgba(220,53,69,0.9)',
            borderRadius: '4px',
            padding: '1px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <FaVideo style={{ color: '#fff', fontSize: '0.55rem' }} />
          <small style={{ color: '#fff', fontSize: '0.6rem', fontWeight: 600 }}>CCTV</small>
        </div>
      </div>
    )
  }
  if (file.file_type === 'image' && file.file) {
    return (
      <img
        src={thumbUrl || file.url}
        alt={file.name}
        style={thumbStyle}
      />
    )
  }
  if (file.file_type === 'video' && file.file) {
    return (
      <div style={{ position: 'relative' }}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={file.name}
            style={{ ...thumbStyle, background: '#000' }}
          />
        ) : (
          <video
            src={file.url}
            muted
            loop
            playsInline
            preload="metadata"
            className="video-thumb"
            style={thumbStyle}
          />
        )}
        <div
          className="video-play-icon"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            transition: 'opacity 0.2s',
          }}
        >
          <FaPlay style={{ color: '#fff', fontSize: '0.8rem', marginLeft: '2px' }} />
        </div>
      </div>
    )
  }
  if (file.file_type === 'web' && file.thumbnail_url) {
    return (
      <div style={{ position: 'relative' }}>
        <img
          src={file.thumbnail_url}
          alt={file.name}
          style={thumbStyle}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none'
            const parent = (e.target as HTMLImageElement).parentElement
            if (parent) parent.classList.add('thumb-fallback')
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '4px',
            right: '4px',
            background: 'rgba(13,110,253,0.85)',
            borderRadius: '4px',
            padding: '1px 6px',
            fontSize: '0.6rem',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <FaGlobe style={{ fontSize: '0.5rem' }} />
          {getDomain(file.source_url || '')}
        </div>
      </div>
    )
  }
  if (file.file_type === 'web' && file.source_url && isImageUrl(file.source_url)) {
    return (
      <img
        src={file.source_url}
        alt={file.name}
        style={thumbStyle}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }
  if (file.file_type === 'web') {
    const domain = getDomain(file.source_url || '')
    return (
      <div
        className="d-flex flex-column align-items-center justify-content-center"
        style={{
          width: '100%',
          aspectRatio: '16/9',
          background: 'linear-gradient(135deg, #e8f4fd 0%, #d0e8f7 100%)',
          borderRadius: '6px 6px 0 0',
        }}
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt=""
          style={{ width: '48px', height: '48px', marginBottom: '6px' }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none'
          }}
        />
        <small
          className="fw-medium text-truncate px-2"
          style={{ fontSize: '0.7rem', color: '#0d6efd', maxWidth: '100%' }}
        >
          {domain}
        </small>
      </div>
    )
  }
  return (
    <div
      className="d-flex flex-column align-items-center justify-content-center"
      style={{
        width: '100%',
        aspectRatio: '16/9',
        backgroundColor: 'var(--bs-gray-200)',
        borderRadius: '6px 6px 0 0',
        fontSize: '2.5rem',
        color: 'var(--bs-gray-500)',
      }}
    >
      <FileTypeIcon type={file.file_type} />
    </div>
  )
}

/** Bigger click-through preview for a MediaFile — shared by the Content
 * page's own grid/list (static/src/components/deploy/deploy-form.tsx,
 * where this used to live before being moved here for reuse) and the
 * Playlist editor's item list. */
export function PreviewModal({
  file,
  onClose,
}: {
  file: MediaFile | null
  onClose: () => void
}) {
  const { t } = useTranslation()

  // Stop CCTV stream when preview modal closes
  useEffect(() => {
    if (!file || file.file_type !== 'cctv' || !file.cctv_config) return
    const configId = file.cctv_config.id
    return () => {
      cctvApi.stop(configId).catch(() => {})
    }
  }, [file])

  if (!file) return null

  return (
    <div
      className="modal d-block"
      tabIndex={-1}
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className={`modal-dialog modal-dialog-centered ${file.file_type === 'cctv' ? 'modal-xl' : 'modal-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content" style={{ borderRadius: '12px', overflow: 'hidden' }}>
          <div className="modal-header py-2 px-3">
            <h6 className="modal-title d-flex align-items-center gap-2 mb-0">
              <FileTypeIcon type={file.file_type} />
              <span className="text-truncate" style={{ maxWidth: '400px' }}>
                {file.name}
              </span>
            </h6>
            <div className="d-flex align-items-center gap-2">
              {file.source_url && file.file_type !== 'cctv' && (
                <a
                  href={file.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm btn-outline-primary py-0"
                  title={t('content.openUrl')}
                >
                  <FaExternalLinkAlt style={{ fontSize: '0.7rem' }} />
                </a>
              )}
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
          </div>
          <div
            className="modal-body p-0 d-flex align-items-center justify-content-center"
            style={{ minHeight: '300px', maxHeight: '75vh', backgroundColor: '#1a1a1a' }}
          >
            {file.file_type === 'image' && file.url && (
              <img
                src={file.url}
                alt={file.name}
                style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
              />
            )}
            {file.file_type === 'video' && file.url && (
              <video
                src={file.url}
                controls
                autoPlay
                style={{ maxWidth: '100%', maxHeight: '75vh' }}
              />
            )}
            {file.file_type === 'web' && file.source_url && (
              isImageUrl(file.source_url) ? (
                <img
                  src={file.source_url}
                  alt={file.name}
                  style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
                />
              ) : (
                <iframe
                  src={file.source_url}
                  title={file.name}
                  style={{
                    width: '100%',
                    height: '75vh',
                    border: 'none',
                    backgroundColor: '#fff',
                  }}
                />
              )
            )}
            {file.file_type === 'cctv' && file.source_url && (
              <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', backgroundColor: '#000' }}>
                <iframe
                  src={file.source_url}
                  title={file.name}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 'none',
                  }}
                  allow="autoplay"
                />
              </div>
            )}
            {file.file_type === 'other' && (
              <div className="text-center text-white p-5">
                <FaFile size={64} className="mb-3" style={{ opacity: 0.5 }} />
                <p>{t('content.noPreview')}</p>
                {file.url && (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-light btn-sm"
                  >
                    {t('content.download')}
                  </a>
                )}
              </div>
            )}
          </div>
          <div className="modal-footer py-2 px-3">
            <small className="text-muted me-auto">
              {file.file_size > 0 && formatFileSize(file.file_size)}
              {file.file_size > 0 && ' · '}
              {file.file_type.toUpperCase()}
            </small>
            <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
