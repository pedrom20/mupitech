import React, { useContext, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  FaListUl,
  FaPlus,
  FaEdit,
  FaTrash,
  FaPlay,
  FaArrowUp,
  FaArrowDown,
  FaTimes,
  FaSearch,
  FaShareSquare,
  FaDesktop,
  FaLayerGroup,
  FaMapMarkerAlt,
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchPlaylists, createPlaylist, updatePlaylist, deletePlaylist, deployPlaylist } from '@/store/playlistsSlice'
import { fetchPlayers } from '@/store/playersSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchLocations } from '@/store/locationsSlice'
import { media as mediaApi } from '@/services/api'
import { FilePreview } from '@/components/shared/media-preview'
import { showToast } from '@/utils/toast'
import { RoleContext, canEditPlaylistTargets } from '@/components/app'
import type { Playlist, PlaylistItem, MediaFile } from '@/types'

interface FormItem {
  media_file: string
  order: number
  duration: number | null
}

const PlaylistList: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [searchParams, setSearchParams] = useSearchParams()
  const role = useContext(RoleContext)
  const canEditTargets = canEditPlaylistTargets(role)
  const { playlists, loading } = useAppSelector((state) => state.playlists)
  const { players } = useAppSelector((state) => state.players)
  const { groups } = useAppSelector((state) => state.groups)
  const { locations } = useAppSelector((state) => state.locations)

  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formItems, setFormItems] = useState<FormItem[]>([])
  const [contentSearch, setContentSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [deployingId, setDeployingId] = useState<string | null>(null)

  // Apply-to (players/groups/locations) — a separate modal from
  // add/edit, so picking where a playlist plays never risks touching
  // its name/description/content.
  const [applyingPlaylist, setApplyingPlaylist] = useState<Playlist | null>(null)
  const [applyTargetPlayers, setApplyTargetPlayers] = useState<string[]>([])
  const [applyTargetGroups, setApplyTargetGroups] = useState<string[]>([])
  const [applyTargetLocations, setApplyTargetLocations] = useState<string[]>([])
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    dispatch(fetchPlaylists())
    dispatch(fetchPlayers())
    dispatch(fetchGroups())
    dispatch(fetchLocations())
    mediaApi.list().then(setMediaFiles).catch(() => {})
  }, [dispatch])

  // Deep-link from other pages (e.g. a device's content list) — /playlists?edit=<id>
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || playlists.length === 0) return
    const target = playlists.find((p) => p.id === editId)
    if (target) {
      handleEdit(target)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, searchParams])

  const mediaFileById = (id: string) => mediaFiles.find((m) => m.id === id)

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormItems([])
    setContentSearch('')
  }

  const handleAdd = () => {
    setEditingPlaylist(null)
    resetForm()
    setShowForm(true)
  }

  const handleEdit = (playlist: Playlist) => {
    setEditingPlaylist(playlist)
    setFormName(playlist.name)
    setFormDescription(playlist.description || '')
    setFormItems(playlist.items.map((it: PlaylistItem) => ({
      media_file: it.media_file, order: it.order, duration: it.duration,
    })))
    setShowForm(true)
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingPlaylist(null)
  }

  const handleAddItem = (mediaId: string) => {
    setFormItems((prev) => [...prev, { media_file: mediaId, order: prev.length, duration: null }])
  }

  const handleRemoveItem = (index: number) => {
    setFormItems((prev) => prev.filter((_, i) => i !== index).map((it, i) => ({ ...it, order: i })))
  }

  const handleMoveItem = (index: number, direction: -1 | 1) => {
    setFormItems((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((it, i) => ({ ...it, order: i }))
    })
  }

  const handleItemDurationChange = (index: number, value: string) => {
    setFormItems((prev) => prev.map((it, i) => i === index ? { ...it, duration: value ? Number(value) : null } : it))
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    // Targets (players/groups/locations) are edited exclusively via the
    // "Apply" modal, not here — omitting them lets the PATCH leave
    // whatever the playlist is already applied to untouched.
    const data = {
      name: formName,
      description: formDescription,
      items: formItems,
    }

    try {
      if (editingPlaylist) {
        await dispatch(updatePlaylist({ id: editingPlaylist.id, data })).unwrap()
      } else {
        await dispatch(createPlaylist(data)).unwrap()
      }
      showToast('success', t('common.success'))
      handleFormClose()
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (playlist: Playlist) => {
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('playlists.confirmDelete'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })
    if (result.isConfirmed) {
      try {
        await dispatch(deletePlaylist(playlist.id)).unwrap()
      } catch (error) {
        Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
      }
    }
  }

  const handleDeploy = async (playlist: Playlist) => {
    setDeployingId(playlist.id)
    try {
      const res = await dispatch(deployPlaylist(playlist.id)).unwrap()
      showToast('success', t('playlists.deployStarted'), t('playlists.deployStartedDesc', { count: res.target_count }))
      setTimeout(() => dispatch(fetchPlaylists()), 4000)
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
    } finally {
      setDeployingId(null)
    }
  }

  const toggleMultiSelect = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const handleOpenApply = (playlist: Playlist) => {
    setApplyingPlaylist(playlist)
    setApplyTargetPlayers(playlist.target_players || [])
    setApplyTargetGroups(playlist.target_groups || [])
    setApplyTargetLocations(playlist.target_locations || [])
  }

  const handleCloseApply = () => setApplyingPlaylist(null)

  const handleSaveApply = async () => {
    if (!applyingPlaylist) return
    setApplying(true)
    try {
      await dispatch(updatePlaylist({
        id: applyingPlaylist.id,
        data: {
          target_players: applyTargetPlayers,
          target_groups: applyTargetGroups,
          target_locations: applyTargetLocations,
        },
      })).unwrap()
      showToast('success', t('common.success'))
      setApplyingPlaylist(null)
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div>
      <div className="fm-page-header">
        <div>
          <h1 className="page-title">
            <FaListUl className="page-icon" />
            {t('playlists.title')}
          </h1>
        </div>
        <div className="page-actions">
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('playlists.addPlaylist')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="fm-loading"><div className="spinner" /></div>
      ) : playlists.length === 0 ? (
        <div className="fm-empty-state">
          <div className="empty-icon"><FaListUl /></div>
          <h3 className="empty-title">{t('common.noResults')}</h3>
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('playlists.addPlaylist')}
          </button>
        </div>
      ) : (
        <div className="row g-3">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="col-sm-6 col-lg-4">
              <div className="fm-card fm-card-accent">
                <div className="fm-card-header">
                  <h5 className="card-title mb-0">{playlist.name}</h5>
                  <div className="card-actions">
                    <button className="fm-btn-icon" onClick={() => handleDeploy(playlist)} title={t('playlists.deploy')} disabled={deployingId === playlist.id}>
                      <FaPlay />
                    </button>
                    <button className="fm-btn-icon" onClick={() => handleEdit(playlist)} title={t('common.edit')}>
                      <FaEdit />
                    </button>
                    <button className="fm-btn-icon" onClick={() => handleDelete(playlist)} title={t('common.delete')} style={{ color: '#dc3545' }}>
                      <FaTrash />
                    </button>
                  </div>
                </div>
                <div className="fm-card-body">
                  {playlist.description && (
                    <p className="text-muted mb-2" style={{ fontSize: '0.875rem' }}>{playlist.description}</p>
                  )}
                  <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>
                    {playlist.items.length} {t('playlists.items')}
                  </p>

                  <div className="mb-2">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <span className="fw-semibold" style={{ fontSize: '0.78rem' }}>{t('playlists.appliedTo')}</span>
                      {canEditTargets && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary py-0 px-2"
                          style={{ fontSize: '0.72rem' }}
                          onClick={() => handleOpenApply(playlist)}
                        >
                          <FaShareSquare className="me-1" />
                          {t('playlists.apply')}
                        </button>
                      )}
                    </div>
                    {!playlist.target_players_detail?.length && !playlist.target_groups_detail?.length && !playlist.target_locations_detail?.length ? (
                      <span className="text-muted" style={{ fontSize: '0.78rem' }}>{t('playlists.noTargets')}</span>
                    ) : (
                      <div className="d-flex flex-wrap gap-1">
                        {playlist.target_players_detail?.map((p) => (
                          <span key={`p-${p.id}`} className="badge bg-secondary-subtle text-secondary-emphasis d-inline-flex align-items-center gap-1" style={{ fontSize: '0.7rem', fontWeight: 500 }}>
                            <FaDesktop style={{ fontSize: '0.65rem' }} />{p.name}
                          </span>
                        ))}
                        {playlist.target_groups_detail?.map((g) => (
                          <span key={`g-${g.id}`} className="badge bg-primary-subtle text-primary-emphasis d-inline-flex align-items-center gap-1" style={{ fontSize: '0.7rem', fontWeight: 500 }}>
                            <FaLayerGroup style={{ fontSize: '0.65rem' }} />{g.name}
                          </span>
                        ))}
                        {playlist.target_locations_detail?.map((l) => (
                          <span key={`l-${l.id}`} className="badge bg-info-subtle text-info-emphasis d-inline-flex align-items-center gap-1" style={{ fontSize: '0.7rem', fontWeight: 500 }}>
                            <FaMapMarkerAlt style={{ fontSize: '0.65rem' }} />{l.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {playlist.last_deployed_at && (
                    <p className="text-muted mb-0" style={{ fontSize: '0.75rem' }}>
                      {t('playlists.lastDeployed')}: {new Date(playlist.last_deployed_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={handleFormClose}>
          <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">
                  {editingPlaylist ? t('playlists.editPlaylist') : t('playlists.addPlaylist')}
                </h5>
                <button type="button" className="btn-close" onClick={handleFormClose} aria-label={t('common.close')} />
              </div>
              <form onSubmit={handleFormSubmit}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('playlists.name')}</label>
                    <input type="text" className="form-control" value={formName} onChange={(e) => setFormName(e.target.value)} required />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('playlists.description')}</label>
                    <textarea className="form-control" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2} />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('playlists.content')}</label>

                    <div className="input-group input-group-sm mb-2">
                      <span className="input-group-text"><FaSearch /></span>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t('playlists.searchContent')}
                        value={contentSearch}
                        onChange={(e) => setContentSearch(e.target.value)}
                      />
                    </div>
                    <div
                      className="border rounded p-2 mb-3 d-flex flex-wrap gap-2"
                      style={{ maxHeight: '220px', overflowY: 'auto' }}
                    >
                      {mediaFiles.length === 0 ? (
                        <span className="text-muted" style={{ fontSize: '0.8rem' }}>{t('common.noResults')}</span>
                      ) : mediaFiles
                        .filter((m) => m.name.toLowerCase().includes(contentSearch.toLowerCase()))
                        .map((m) => (
                          <div
                            key={m.id}
                            role="button"
                            title={t('playlists.addContentHint', { name: m.name })}
                            onClick={() => handleAddItem(m.id)}
                            style={{ width: '96px', cursor: 'pointer' }}
                          >
                            <div className="rounded overflow-hidden border" style={{ width: '96px' }}>
                              <FilePreview file={m} />
                            </div>
                            <small
                              className="d-block text-truncate mt-1"
                              style={{ fontSize: '0.7rem' }}
                              title={m.name}
                            >
                              {m.name}
                            </small>
                          </div>
                        ))}
                    </div>

                    <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>
                      {t('playlists.playlistItems')} ({formItems.length})
                    </label>
                    {formItems.length === 0 ? (
                      <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('playlists.noItemsYet')}</p>
                    ) : (
                      <ul className="list-group">
                        {formItems.map((item, index) => {
                          const file = mediaFileById(item.media_file)
                          return (
                            <li key={`${item.media_file}-${index}`} className="list-group-item d-flex align-items-center gap-2">
                              <span className="text-muted" style={{ fontSize: '0.8rem', width: '18px' }}>{index + 1}.</span>
                              <div className="rounded overflow-hidden border flex-shrink-0" style={{ width: '56px' }}>
                                {file ? <FilePreview file={file} /> : (
                                  <div style={{ width: '56px', aspectRatio: '16/9', background: 'var(--bs-gray-200)' }} />
                                )}
                              </div>
                              <span className="flex-grow-1 text-truncate">{file?.name || item.media_file}</span>
                              <input
                                type="number"
                                className="form-control form-control-sm"
                                style={{ width: '90px' }}
                                placeholder={t('playlists.durationSec')}
                                value={item.duration ?? ''}
                                onChange={(e) => handleItemDurationChange(index, e.target.value)}
                              />
                              <button type="button" className="fm-btn-icon" onClick={() => handleMoveItem(index, -1)} disabled={index === 0}>
                                <FaArrowUp />
                              </button>
                              <button type="button" className="fm-btn-icon" onClick={() => handleMoveItem(index, 1)} disabled={index === formItems.length - 1}>
                                <FaArrowDown />
                              </button>
                              <button type="button" className="fm-btn-icon" onClick={() => handleRemoveItem(index)} style={{ color: '#dc3545' }}>
                                <FaTimes />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleFormClose}>{t('common.cancel')}</button>
                  <button type="submit" className="fm-btn-primary" disabled={saving}>
                    {saving ? t('common.loading') : t('common.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {applyingPlaylist && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={handleCloseApply}>
          <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">
                  <FaShareSquare className="me-2" />
                  {t('playlists.applyTitle', { name: applyingPlaylist.name })}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseApply} aria-label={t('common.close')} />
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('playlists.applyDesc')}</p>
                <div className="row">
                  <div className="col-md-4 mb-3">
                    <label className="form-label fw-semibold d-flex align-items-center gap-1"><FaDesktop />{t('nav.players')}</label>
                    <div className="border rounded p-2" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                      {players.map((p) => (
                        <div className="form-check" key={p.id}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={applyTargetPlayers.includes(p.id)}
                            onChange={() => toggleMultiSelect(applyTargetPlayers, setApplyTargetPlayers, p.id)}
                            id={`apply-player-${p.id}`}
                          />
                          <label className="form-check-label" htmlFor={`apply-player-${p.id}`} style={{ fontSize: '0.85rem' }}>{p.name}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="col-md-4 mb-3">
                    <label className="form-label fw-semibold d-flex align-items-center gap-1"><FaLayerGroup />{t('nav.groups')}</label>
                    <div className="border rounded p-2" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                      {groups.map((g) => (
                        <div className="form-check" key={g.id}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={applyTargetGroups.includes(g.id)}
                            onChange={() => toggleMultiSelect(applyTargetGroups, setApplyTargetGroups, g.id)}
                            id={`apply-group-${g.id}`}
                          />
                          <label className="form-check-label" htmlFor={`apply-group-${g.id}`} style={{ fontSize: '0.85rem' }}>{g.name}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="col-md-4 mb-3">
                    <label className="form-label fw-semibold d-flex align-items-center gap-1"><FaMapMarkerAlt />{t('nav.locations')}</label>
                    <div className="border rounded p-2" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                      {locations.map((l) => (
                        <div className="form-check" key={l.id}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={applyTargetLocations.includes(l.id)}
                            onChange={() => toggleMultiSelect(applyTargetLocations, setApplyTargetLocations, l.id)}
                            id={`apply-location-${l.id}`}
                          />
                          <label className="form-check-label" htmlFor={`apply-location-${l.id}`} style={{ fontSize: '0.85rem' }}>{l.name}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCloseApply}>{t('common.cancel')}</button>
                <button type="button" className="fm-btn-primary" onClick={handleSaveApply} disabled={applying}>
                  {applying ? t('common.loading') : t('playlists.apply')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PlaylistList
