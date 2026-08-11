import React, { useEffect, useState } from 'react'
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
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchPlaylists, createPlaylist, updatePlaylist, deletePlaylist, deployPlaylist } from '@/store/playlistsSlice'
import { fetchPlayers } from '@/store/playersSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchLocations } from '@/store/locationsSlice'
import { media as mediaApi } from '@/services/api'
import { FilePreview } from '@/components/shared/media-preview'
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
  const [formTargetPlayers, setFormTargetPlayers] = useState<string[]>([])
  const [formTargetGroups, setFormTargetGroups] = useState<string[]>([])
  const [formTargetLocations, setFormTargetLocations] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deployingId, setDeployingId] = useState<string | null>(null)

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
    setFormTargetPlayers([])
    setFormTargetGroups([])
    setFormTargetLocations([])
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
    setFormTargetPlayers(playlist.target_players || [])
    setFormTargetGroups(playlist.target_groups || [])
    setFormTargetLocations(playlist.target_locations || [])
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

  const toggleMultiSelect = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const data = {
      name: formName,
      description: formDescription,
      items: formItems,
      target_players: formTargetPlayers,
      target_groups: formTargetGroups,
      target_locations: formTargetLocations,
    }

    try {
      if (editingPlaylist) {
        await dispatch(updatePlaylist({ id: editingPlaylist.id, data })).unwrap()
      } else {
        await dispatch(createPlaylist(data)).unwrap()
      }
      Swal.fire({ icon: 'success', title: t('common.success'), timer: 1500, showConfirmButton: false })
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
      Swal.fire({
        icon: 'success',
        title: t('playlists.deployStarted'),
        text: t('playlists.deployStartedDesc', { count: res.target_count }),
        timer: 2500,
        showConfirmButton: false,
      })
      setTimeout(() => dispatch(fetchPlaylists()), 4000)
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
    } finally {
      setDeployingId(null)
    }
  }

  const targetSummary = (playlist: Playlist) => {
    const parts = []
    if (playlist.target_players_detail?.length) parts.push(`${playlist.target_players_detail.length} ${t('nav.players')}`)
    if (playlist.target_groups_detail?.length) parts.push(`${playlist.target_groups_detail.length} ${t('nav.groups')}`)
    if (playlist.target_locations_detail?.length) parts.push(`${playlist.target_locations_detail.length} ${t('nav.locations')}`)
    return parts.length ? parts.join(', ') : t('playlists.noTargets')
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
                  <p className="text-muted mb-1" style={{ fontSize: '0.8rem' }}>
                    {playlist.items.length} {t('playlists.items')} · {targetSummary(playlist)}
                  </p>
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

                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label fw-semibold">{t('nav.players')}</label>
                      <div className="border rounded p-2" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                        {players.map((p) => (
                          <div className="form-check" key={p.id}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={formTargetPlayers.includes(p.id)}
                              onChange={() => toggleMultiSelect(formTargetPlayers, setFormTargetPlayers, p.id)}
                              id={`pl-player-${p.id}`}
                            />
                            <label className="form-check-label" htmlFor={`pl-player-${p.id}`} style={{ fontSize: '0.85rem' }}>{p.name}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label fw-semibold">{t('nav.groups')}</label>
                      <div className="border rounded p-2" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                        {groups.map((g) => (
                          <div className="form-check" key={g.id}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={formTargetGroups.includes(g.id)}
                              onChange={() => toggleMultiSelect(formTargetGroups, setFormTargetGroups, g.id)}
                              id={`pl-group-${g.id}`}
                            />
                            <label className="form-check-label" htmlFor={`pl-group-${g.id}`} style={{ fontSize: '0.85rem' }}>{g.name}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label fw-semibold">{t('nav.locations')}</label>
                      <div className="border rounded p-2" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                        {locations.map((l) => (
                          <div className="form-check" key={l.id}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={formTargetLocations.includes(l.id)}
                              onChange={() => toggleMultiSelect(formTargetLocations, setFormTargetLocations, l.id)}
                              id={`pl-location-${l.id}`}
                            />
                            <label className="form-check-label" htmlFor={`pl-location-${l.id}`} style={{ fontSize: '0.85rem' }}>{l.name}</label>
                          </div>
                        ))}
                      </div>
                    </div>
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
    </div>
  )
}

export default PlaylistList
