import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaFolder } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { folders as foldersApi } from '@/services/api'
import { showToast } from '@/utils/toast'
import type { MediaFolder } from '@/types'

/** Admin-only control for content/scoping.py's "common" flag — the one
 * write path for MediaFolder.is_common (see content/views.py::
 * MediaFolderViewSet.set_common; the Content page's own folder editor
 * deliberately can't touch it). Marking a folder common makes it, and
 * everything nested under it, visible to every editor regardless of
 * their own location/group access.model.UserAccessScope. */
const ContentLibrarySettings: React.FC = () => {
  const { t } = useTranslation()
  const [folders, setFolders] = useState<MediaFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    foldersApi.list().then(setFolders).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleToggle = (folder: MediaFolder, checked: boolean) => {
    setBusyId(folder.id)
    foldersApi.setCommon(folder.id, checked).then(() => {
      showToast('success', t('common.success'))
      load()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setBusyId(null))
  }

  // Flatten into a depth-ordered list (parent immediately followed by
  // its own children, recursively) so the tree renders correctly as a
  // simple indented list without needing a real tree component.
  const ordered: { folder: MediaFolder; depth: number }[] = []
  const byParent = new Map<string | null, MediaFolder[]>()
  for (const f of folders) {
    const key = f.parent
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(f)
  }
  const walk = (parentId: string | null, depth: number) => {
    for (const f of byParent.get(parentId) || []) {
      ordered.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)

  return (
    <div className="row g-3">
      <div className="col-lg-8">
        <div className="fm-card fm-card-accent">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaFolder className="me-2" />
              {t('contentLibrary.title')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('contentLibrary.description')}</p>

            {loading ? (
              <p className="form-text mb-0">{t('common.loading')}</p>
            ) : ordered.length === 0 ? (
              <p className="form-text mb-0">{t('contentLibrary.empty')}</p>
            ) : (
              <div className="d-flex flex-column gap-2">
                {ordered.map(({ folder, depth }) => (
                  <div
                    key={folder.id}
                    className="d-flex align-items-center justify-content-between gap-2 py-1"
                    style={{ paddingLeft: `${depth * 1.5}rem`, borderBottom: '1px solid var(--bs-border-color-translucent)' }}
                  >
                    <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.85rem' }}>
                      <FaFolder className="text-warning" />
                      <span>{folder.name}</span>
                      {!folder.is_common && folder.effective_is_common && (
                        <span className="badge bg-success-subtle text-success-emphasis" style={{ fontSize: '0.65rem' }}>
                          {t('contentLibrary.inheritedCommon')}
                        </span>
                      )}
                      {(folder.location_name || folder.group_name) && (
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                          {[folder.location_name, folder.group_name].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    <div className="form-check form-switch mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        checked={folder.is_common}
                        disabled={busyId === folder.id}
                        onChange={(e) => handleToggle(folder, e.target.checked)}
                      />
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

export default ContentLibrarySettings
