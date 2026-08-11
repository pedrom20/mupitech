import React from 'react'
import { FaImage, FaVideo, FaGlobe, FaFile, FaPlay } from 'react-icons/fa'
import type { MediaFile } from '@/types'

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
