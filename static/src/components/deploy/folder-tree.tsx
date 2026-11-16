import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaFolder, FaFolderOpen, FaChevronRight, FaChevronDown, FaPhotoVideo, FaPen } from 'react-icons/fa'
import type { MediaFolder } from '@/types'

// Single custom MIME used for both files and folders being dragged —
// simpler to read back in onDrop than juggling two separate MIME types.
export const DRAG_MIME = 'application/x-mupitech-item'

export interface DragItem {
  type: 'file' | 'folder'
  id: string
}

export function readDragItem(e: React.DragEvent): DragItem | null {
  const raw = e.dataTransfer.getData(DRAG_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DragItem
  } catch {
    return null
  }
}

// dragenter/dragleave bubble from every child element (icon, label,
// counter badge), so a plain "clear on dragleave" flickers the
// highlight on/off as the pointer crosses them inside the same row.
// Only treat it as a real leave once the pointer lands outside the
// row entirely.
function isRealDragLeave(e: React.DragEvent): boolean {
  const related = e.relatedTarget as Node | null
  return !related || !e.currentTarget.contains(related)
}

interface FolderTreeProps {
  folders: MediaFolder[]
  selectedFolderId: string | null
  onSelect: (folderId: string | null) => void
  onMoveFile: (fileId: string, folderId: string | null) => void
  onMoveFolder: (folderId: string, newParentId: string | null) => void
  canEdit: boolean
  onEdit: (e: React.MouseEvent, folder: MediaFolder) => void
  onDelete: (e: React.MouseEvent, folder: MediaFolder) => void
}

const FolderTree: React.FC<FolderTreeProps> = ({
  folders, selectedFolderId, onSelect, onMoveFile, onMoveFolder, canEdit, onEdit, onDelete,
}) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverRoot, setDragOverRoot] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDrop = (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverId(null)
    setDragOverRoot(false)
    const item = readDragItem(e)
    if (!item) return
    if (item.type === 'file') onMoveFile(item.id, targetFolderId)
    else if (item.id !== targetFolderId) onMoveFolder(item.id, targetFolderId)
  }

  const renderNode = (folder: MediaFolder, depth: number) => {
    const children = folders.filter((f) => f.parent === folder.id)
    const hasChildren = children.length > 0
    const isExpanded = expanded.has(folder.id)
    const isSelected = selectedFolderId === folder.id
    const isDragOver = dragOverId === folder.id

    return (
      <div key={folder.id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: 'folder', id: folder.id }))
            e.dataTransfer.effectAllowed = 'move'
            setDraggingId(folder.id)
          }}
          onDragEnd={() => setDraggingId(null)}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(folder.id) }}
          onDragLeave={(e) => {
            e.stopPropagation()
            if (isRealDragLeave(e)) setDragOverId((prev) => (prev === folder.id ? null : prev))
          }}
          onDrop={(e) => handleDrop(e, folder.id)}
          onClick={() => onSelect(folder.id)}
          onContextMenu={(e) => { e.preventDefault(); onDelete(e, folder) }}
          className="d-flex align-items-center gap-1"
          style={{
            paddingLeft: `${depth * 16 + 4}px`,
            paddingTop: '6px',
            paddingBottom: '6px',
            paddingRight: '4px',
            minHeight: '30px',
            marginBottom: '2px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.82rem',
            opacity: draggingId === folder.id ? 0.4 : 1,
            border: isDragOver ? '2px solid var(--bs-primary)' : '2px solid transparent',
            background: isDragOver
              ? 'var(--bs-primary-bg-subtle)'
              : isSelected ? 'var(--bs-primary-bg-subtle)' : 'transparent',
            boxShadow: isDragOver ? '0 0 0 2px var(--bs-primary-border-subtle, var(--bs-primary)) inset' : 'none',
            transition: 'background 0.1s, border-color 0.1s',
          }}
          title={`${folder.name} (${folder.file_count})`}
        >
          <span
            style={{ width: '14px', display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpanded(folder.id) }}
          >
            {hasChildren && (
              isExpanded
                ? <FaChevronDown style={{ fontSize: '0.6rem' }} />
                : <FaChevronRight style={{ fontSize: '0.6rem' }} />
            )}
          </span>
          {isSelected ? (
            <FaFolderOpen style={{ color: '#ffc107', flexShrink: 0 }} />
          ) : (
            <FaFolder style={{ color: '#ffc107', flexShrink: 0 }} />
          )}
          <span className="text-truncate flex-grow-1">{folder.name}</span>
          <small className="text-muted" style={{ fontSize: '0.65rem' }}>{folder.file_count}</small>
          {canEdit && (
            <button
              type="button"
              className="btn btn-sm p-0"
              style={{ fontSize: '0.6rem', lineHeight: 1, background: 'transparent', border: 'none', flexShrink: 0 }}
              onClick={(e) => onEdit(e, folder)}
              title={t('common.edit')}
            >
              <FaPen className="text-muted" />
            </button>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const rootFolders = folders.filter((f) => f.parent === null)

  return (
    <div>
      <div
        onClick={() => onSelect(null)}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDragEnter={(e) => { e.preventDefault(); setDragOverRoot(true) }}
        onDragLeave={(e) => { if (isRealDragLeave(e)) setDragOverRoot(false) }}
        onDrop={(e) => handleDrop(e, null)}
        className="d-flex align-items-center gap-1 mb-1"
        style={{
          padding: '7px 4px',
          minHeight: '32px',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '0.85rem',
          fontWeight: 600,
          border: dragOverRoot ? '2px solid var(--bs-primary)' : '2px solid transparent',
          background: dragOverRoot
            ? 'var(--bs-primary-bg-subtle)'
            : selectedFolderId === null ? 'var(--bs-primary-bg-subtle)' : 'transparent',
          transition: 'background 0.1s, border-color 0.1s',
        }}
      >
        <FaPhotoVideo style={{ flexShrink: 0 }} />
        <span className="text-truncate">{t('content.rootFolder')}</span>
      </div>
      <div>
        {rootFolders.map((folder) => renderNode(folder, 0))}
      </div>
    </div>
  )
}

export default FolderTree
