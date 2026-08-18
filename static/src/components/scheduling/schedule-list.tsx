import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaCalendarAlt, FaPlus, FaTrash, FaDesktop, FaLayerGroup, FaMapMarkerAlt, FaListUl, FaPhotoVideo } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchPlayers } from '@/store/playersSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchLocations } from '@/store/locationsSlice'
import { fetchPlaylists } from '@/store/playlistsSlice'
import { schedules as schedulesApi, media as mediaApi } from '@/services/api'
import { showToast } from '@/utils/toast'
import { RoleContext, canEditPlaylistTargets } from '@/components/app'
import type { ScheduledDeployment, MediaFile } from '@/types'

const SchedulingPage: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const role = useContext(RoleContext)
  const canOverridePlaylistTargets = canEditPlaylistTargets(role)
  const { players } = useAppSelector((state) => state.players)
  const { groups } = useAppSelector((state) => state.groups)
  const { locations } = useAppSelector((state) => state.locations)
  const { playlists } = useAppSelector((state) => state.playlists)

  const [schedules, setSchedules] = useState<ScheduledDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])

  const [showCreate, setShowCreate] = useState(false)
  const [contentType, setContentType] = useState<'media' | 'playlist'>('media')
  const [selectedMediaId, setSelectedMediaId] = useState('')
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('')
  const [targetPlayers, setTargetPlayers] = useState<string[]>([])
  const [targetGroups, setTargetGroups] = useState<string[]>([])
  const [targetLocations, setTargetLocations] = useState<string[]>([])
  const [duration, setDuration] = useState(10)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)

  const loadSchedules = () => {
    setLoading(true)
    schedulesApi.list().then(setSchedules).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadSchedules()
    mediaApi.list().then(setMediaFiles).catch(() => {})
    dispatch(fetchPlayers())
    dispatch(fetchGroups())
    dispatch(fetchLocations())
    dispatch(fetchPlaylists())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch])

  const resetForm = () => {
    setContentType('media')
    setSelectedMediaId('')
    setSelectedPlaylistId('')
    setTargetPlayers([])
    setTargetGroups([])
    setTargetLocations([])
    setDuration(10)
    setStartDate('')
    setEndDate('')
  }

  const toggleTarget = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  // Playlist schedules can optionally override the playlist's own
  // targets with an ad-hoc set (see content/views.py::
  // ScheduledDeploymentViewSet.perform_create) — same admin-only gate
  // as the Playlists page's own "Apply to" picker, so this can't be
  // used as a back door around that restriction.
  const showPlaylistTargetPicker = contentType === 'playlist' && canOverridePlaylistTargets

  const handleCreate = async () => {
    if (contentType === 'media' && !selectedMediaId) return
    if (contentType === 'playlist' && !selectedPlaylistId) return
    if (contentType === 'media' && targetPlayers.length === 0 && targetGroups.length === 0 && targetLocations.length === 0) {
      Swal.fire({ icon: 'warning', title: t('scheduling.noTargets') })
      return
    }
    setSaving(true)
    try {
      const includeTargets = contentType === 'media' || showPlaylistTargetPicker
      await schedulesApi.create({
        media_file: contentType === 'media' ? selectedMediaId : undefined,
        playlist: contentType === 'playlist' ? selectedPlaylistId : undefined,
        target_players: includeTargets ? targetPlayers : undefined,
        target_groups: includeTargets ? targetGroups : undefined,
        target_locations: includeTargets ? targetLocations : undefined,
        duration: contentType === 'media' ? duration : undefined,
        start_date: startDate ? new Date(startDate).toISOString() : null,
        end_date: endDate ? new Date(endDate).toISOString() : null,
      })
      showToast('success', t('scheduling.created'))
      setShowCreate(false)
      resetForm()
      loadSchedules()
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async (schedule: ScheduledDeployment) => {
    const result = await Swal.fire({
      icon: 'warning',
      title: t('common.confirm'),
      text: t('scheduling.confirmCancel'),
      showCancelButton: true,
      confirmButtonText: t('scheduling.cancelSchedule'),
      cancelButtonText: t('common.cancel'),
      confirmButtonColor: '#dc3545',
    })
    if (!result.isConfirmed) return
    try {
      await schedulesApi.cancel(schedule.id)
      showToast('success', t('scheduling.cancelled'))
      loadSchedules()
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const statusOf = (s: ScheduledDeployment): 'upcoming' | 'active' | 'expired' => {
    const now = Date.now()
    const start = s.start_date ? new Date(s.start_date).getTime() : null
    const end = s.end_date ? new Date(s.end_date).getTime() : null
    if (start && start > now) return 'upcoming'
    if (end && end < now) return 'expired'
    return 'active'
  }

  const targetSummary = (s: ScheduledDeployment): string => {
    if (s.playlist) return t('scheduling.usesPlaylistTargets')
    const parts: string[] = []
    if (s.target_players_detail?.length) parts.push(...s.target_players_detail.map((p) => p.name))
    if (s.target_groups_detail?.length) parts.push(...s.target_groups_detail.map((g) => `${g.name} (${t('groups.title')})`))
    if (s.target_locations_detail?.length) parts.push(...s.target_locations_detail.map((l) => `${l.name} (${t('locations.title')})`))
    return parts.join(', ') || '—'
  }

  return (
    <div className="container-fluid px-3 py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0"><FaCalendarAlt className="me-2" />{t('nav.scheduling')}</h4>
        <button className="fm-btn-primary" onClick={() => { resetForm(); setShowCreate(true) }}>
          <FaPlus className="me-1" />{t('scheduling.newSchedule')}
        </button>
      </div>

      <div className="fm-card">
        <div className="fm-card-body">
          {loading ? (
            <p className="text-muted text-center">{t('common.loading')}</p>
          ) : schedules.length === 0 ? (
            <p className="text-muted text-center py-4">{t('scheduling.empty')}</p>
          ) : (
            <div className="table-responsive">
              <table className="fm-table table table-hover mb-0">
                <thead>
                  <tr>
                    <th>{t('scheduling.content')}</th>
                    <th>{t('scheduling.targets')}</th>
                    <th>{t('scheduling.window')}</th>
                    <th>{t('common.status')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => {
                    const status = statusOf(s)
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.playlist ? <FaListUl className="me-1 text-muted" /> : <FaPhotoVideo className="me-1 text-muted" />}
                          {s.media_file_detail?.name || s.playlist_detail?.name || '—'}
                        </td>
                        <td style={{ fontSize: '0.85rem' }} className="text-muted">{targetSummary(s)}</td>
                        <td style={{ fontSize: '0.85rem' }}>
                          {s.start_date ? new Date(s.start_date).toLocaleString() : t('scheduling.noStart')}
                          {' → '}
                          {s.end_date ? new Date(s.end_date).toLocaleString() : t('scheduling.noEnd')}
                        </td>
                        <td>
                          <span className={`badge ${status === 'active' ? 'bg-success' : status === 'upcoming' ? 'bg-info' : 'bg-secondary'}`}>
                            {t(`scheduling.status.${status}`)}
                          </span>
                        </td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-outline-danger" onClick={() => handleCancel(s)} title={t('scheduling.cancelSchedule')}>
                            <FaTrash />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowCreate(false)}>
          <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">{t('scheduling.newSchedule')}</h5>
                <button type="button" className="btn-close" onClick={() => setShowCreate(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <div className="btn-group w-100" role="group">
                    <button type="button" className={`btn btn-sm ${contentType === 'media' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setContentType('media')}>
                      <FaPhotoVideo className="me-1" />{t('scheduling.typeMedia')}
                    </button>
                    <button type="button" className={`btn btn-sm ${contentType === 'playlist' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setContentType('playlist')}>
                      <FaListUl className="me-1" />{t('scheduling.typePlaylist')}
                    </button>
                  </div>
                </div>

                {contentType === 'media' ? (
                  <div className="mb-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('scheduling.chooseContent')}</label>
                    <select className="form-select form-select-sm" value={selectedMediaId} onChange={(e) => setSelectedMediaId(e.target.value)}>
                      <option value="">{t('common.select')}</option>
                      {mediaFiles.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="mb-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('scheduling.choosePlaylist')}</label>
                    <select className="form-select form-select-sm" value={selectedPlaylistId} onChange={(e) => setSelectedPlaylistId(e.target.value)}>
                      <option value="">{t('common.select')}</option>
                      {playlists.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {showPlaylistTargetPicker ? (
                      <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('scheduling.playlistTargetsOverrideHint')}</div>
                    ) : (
                      <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('scheduling.playlistTargetsHint')}</div>
                    )}
                  </div>
                )}

                {(contentType === 'media' || showPlaylistTargetPicker) && (
                  <>
                    <div className="mb-3">
                      <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('nav.players')}</label>
                      <div className="d-flex flex-wrap gap-2" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                        {players.map((p) => (
                          <button key={p.id} type="button" className={`btn btn-sm ${targetPlayers.includes(p.id) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => toggleTarget(targetPlayers, setTargetPlayers, p.id)}>
                            <FaDesktop className="me-1" style={{ fontSize: '0.7rem' }} />{p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('groups.title')}</label>
                      <div className="d-flex flex-wrap gap-2">
                        {groups.map((g) => (
                          <button key={g.id} type="button" className={`btn btn-sm ${targetGroups.includes(g.id) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => toggleTarget(targetGroups, setTargetGroups, g.id)}>
                            <FaLayerGroup className="me-1" style={{ fontSize: '0.7rem' }} />{g.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('locations.title')}</label>
                      <div className="d-flex flex-wrap gap-2">
                        {locations.map((l) => (
                          <button key={l.id} type="button" className={`btn btn-sm ${targetLocations.includes(l.id) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => toggleTarget(targetLocations, setTargetLocations, l.id)}>
                            <FaMapMarkerAlt className="me-1" style={{ fontSize: '0.7rem' }} />{l.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {contentType === 'media' && (
                      <div className="mb-3">
                        <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('assets.duration')}</label>
                        <input type="number" className="form-control form-control-sm" style={{ maxWidth: '120px' }} value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={1} />
                      </div>
                    )}
                  </>
                )}

                <div className="row g-2">
                  <div className="col-6">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('scheduling.startDate')}</label>
                    <input type="datetime-local" className="form-control form-control-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.85rem' }}>{t('scheduling.endDate')}</label>
                    <input type="datetime-local" className="form-control form-control-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
                <button type="button" className="fm-btn-primary" onClick={handleCreate} disabled={saving}>
                  {saving ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                  {t('scheduling.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SchedulingPage
