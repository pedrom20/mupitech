import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaFolder, FaFolderPlus } from 'react-icons/fa'
import { useNavigate } from 'react-router-dom'
import Swal from 'sweetalert2'
import { folders as foldersApi } from '@/services/api'
import { showToast } from '@/utils/toast'
import { RoleContext } from '@/components/app'
import type { MediaFolder } from '@/types'

interface ScopedFoldersPanelProps {
  locationId?: string
  groupId?: string
}

/** Which content folders belong directly to this location/group — the
 * flip side of the folder editor's own location/group pickers (see
 * static/src/components/deploy/deploy-form.tsx), surfaced here instead
 * since "what folders does this place own" is what a location/group
 * owner actually wants to see, not the other way around. Only matches a
 * folder's OWN location/group field, not effective_* (inherited from an
 * ancestor) — a folder nested under a common ancestor still "belongs"
 * to whichever place it was directly assigned to, if any. */
const ScopedFoldersPanel: React.FC<ScopedFoldersPanelProps> = ({ locationId, groupId }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const role = useContext(RoleContext)
  const [folders, setFolders] = useState<MediaFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    foldersApi.list().then(setFolders).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const scoped = folders.filter((f) => (locationId ? f.location === locationId : f.group === groupId))

  const handleCreate = () => {
    if (!newName.trim()) return
    setSaving(true)
    foldersApi.create({
      name: newName.trim(),
      location: locationId || null,
      group: groupId || null,
    }).then((folder) => {
      setFolders((prev) => [...prev, folder])
      setNewName('')
      setCreating(false)
      showToast('success', t('common.success'))
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setSaving(false))
  }

  return (
    <div className="border rounded p-2 mb-3">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <p className="fw-semibold mb-0" style={{ fontSize: '0.85rem' }}>
          <FaFolder className="me-1" />
          {t('scopedFolders.title')}
        </p>
        {role !== 'viewer' && !creating && (
          <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setCreating(true)}>
            <FaFolderPlus className="me-1" />
            {t('scopedFolders.newFolder')}
          </button>
        )}
      </div>

      {creating && (
        <div className="d-flex gap-2 mb-2">
          <input
            type="text"
            className="form-control form-control-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('scopedFolders.folderNamePlaceholder')}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
          />
          <button type="button" className="btn btn-sm fm-btn-primary" onClick={handleCreate} disabled={saving || !newName.trim()}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-sm fm-btn-outline" onClick={() => { setCreating(false); setNewName('') }}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-muted mb-0" style={{ fontSize: '0.8rem' }}>{t('common.loading')}</p>
      ) : scoped.length === 0 ? (
        <p className="text-muted mb-0" style={{ fontSize: '0.8rem' }}>{t('scopedFolders.empty')}</p>
      ) : (
        <ul className="list-unstyled mb-0">
          {scoped.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                className="btn btn-sm btn-link p-0 d-flex align-items-center gap-2"
                style={{ fontSize: '0.85rem' }}
                onClick={() => navigate(`/deploy?folder=${folder.id}`)}
              >
                <FaFolder className="text-warning" />
                {folder.name}
                <span className="text-muted">({folder.file_count})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ScopedFoldersPanel
