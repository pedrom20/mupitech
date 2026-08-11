import React, { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FaLayerGroup,
  FaPlus,
  FaEdit,
  FaTrash,
  FaMapMarkerAlt,
  FaSyncAlt,
  FaDesktop,
  FaImage,
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchGroups, createGroup, updateGroup, deleteGroup } from '@/store/groupsSlice'
import { fetchPlayers } from '@/store/playersSlice'
import { fetchLocations } from '@/store/locationsSlice'
import { groups as groupsApi, system as systemApi } from '@/services/api'
import type { Group } from '@/types'

const ROTATION_OPTIONS: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270]

const GroupList: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { groups, loading } = useAppSelector((state) => state.groups)
  const { players } = useAppSelector((state) => state.players)
  const { locations } = useAppSelector((state) => state.locations)

  const [showForm, setShowForm] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState('#0082C8')
  const [formDescription, setFormDescription] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const [rotationGroup, setRotationGroup] = useState<Group | null>(null)
  const [rotationValue, setRotationValue] = useState<0 | 90 | 180 | 270>(0)
  const [applyingRotation, setApplyingRotation] = useState(false)
  const [detailGroup, setDetailGroup] = useState<Group | null>(null)
  const [pushLogoGroup, setPushLogoGroup] = useState<Group | null>(null)
  const [pushLogoSshUser, setPushLogoSshUser] = useState('pi')
  const [pushLogoSshPassword, setPushLogoSshPassword] = useState('')
  const [pushLogoSshPort, setPushLogoSshPort] = useState(22)
  const [pushingLogo, setPushingLogo] = useState(false)
  const [pushTargetLogo, setPushTargetLogo] = useState(true)
  const [pushTargetStandby, setPushTargetStandby] = useState(false)
  const [pushTargetTheme, setPushTargetTheme] = useState(false)
  const [brandingHasStandby, setBrandingHasStandby] = useState(false)
  const [uploadingGroupLogo, setUploadingGroupLogo] = useState(false)
  const [uploadingGroupStandby, setUploadingGroupStandby] = useState(false)
  const groupLogoInputRef = useRef<HTMLInputElement>(null)
  const groupStandbyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    dispatch(fetchGroups())
    dispatch(fetchPlayers())
    dispatch(fetchLocations())
  }, [dispatch])

  const getPlayersInGroup = (groupId: string) => {
    return players.filter((p) => {
      const pGroupId = p.group_detail?.id || p.group?.id
      return pGroupId === groupId
    })
  }

  const handleAdd = () => {
    setEditingGroup(null)
    setFormName('')
    setFormColor('#0082C8')
    setFormDescription('')
    setFormLocation('')
    setShowForm(true)
  }

  const handleEdit = (group: Group) => {
    setEditingGroup(group)
    setFormName(group.name)
    setFormColor(group.color || '#0082C8')
    setFormDescription(group.description || '')
    setFormLocation(group.location || '')
    setShowForm(true)
  }

  const handleDelete = async (group: Group) => {
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('groups.confirmDelete'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })

    if (result.isConfirmed) {
      try {
        await dispatch(deleteGroup(group.id)).unwrap()
        Swal.fire({
          icon: 'success',
          title: t('groups.deleted'),
          timer: 1500,
          showConfirmButton: false,
        })
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: t('common.error'),
          text: String(error),
        })
      }
    }
  }

  const handleOpenRotation = (group: Group) => {
    setRotationGroup(group)
    setRotationValue(0)
  }

  const handleApplyRotation = async () => {
    if (!rotationGroup) return
    setApplyingRotation(true)
    try {
      const res = await groupsApi.applyRotation(rotationGroup.id, rotationValue)
      const failed = Object.values(res.results).filter((r) => !r.success)
      if (failed.length === 0) {
        Swal.fire({
          icon: 'success',
          title: t('groups.rotationApplied'),
          text: t('groups.rotationAppliedDesc', { count: Object.keys(res.results).length }),
          timer: 2500,
          showConfirmButton: false,
        })
      } else {
        Swal.fire({
          icon: 'warning',
          title: t('groups.rotationPartial'),
          text: failed.map((f) => f.name).join(', '),
        })
      }
      setRotationGroup(null)
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
    } finally {
      setApplyingRotation(false)
    }
  }

  const handleOpenPushLogo = (group: Group) => {
    setPushLogoGroup(group)
    systemApi.getBranding().then((res) => setBrandingHasStandby(res.has_standby_image)).catch(() => {})
  }

  const handlePushLogo = async () => {
    if (!pushLogoGroup || !pushLogoSshPassword || (!pushTargetLogo && !pushTargetStandby && !pushTargetTheme)) return
    setPushingLogo(true)
    try {
      const res = await groupsApi.pushBranding(pushLogoGroup.id, pushLogoSshUser, pushLogoSshPassword, pushLogoSshPort, pushTargetLogo, pushTargetStandby, pushTargetTheme)
      const failed = Object.values(res.results).filter((r) => !r.success)
      if (failed.length === 0) {
        Swal.fire({
          icon: 'success',
          title: t('branding.pushed'),
          timer: 2000,
          showConfirmButton: false,
        })
      } else {
        Swal.fire({
          icon: 'warning',
          title: t('branding.pushPartial'),
          text: failed.map((f) => f.name).join(', '),
        })
      }
      setPushLogoGroup(null)
      setPushLogoSshPassword('')
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
    } finally {
      setPushingLogo(false)
    }
  }

  const handleGroupLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !detailGroup) return
    setUploadingGroupLogo(true)
    try {
      const res = await groupsApi.uploadLogo(detailGroup.id, file)
      setDetailGroup({ ...detailGroup, splash_logo: res.logo_url })
      dispatch(fetchGroups())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingGroupLogo(false)
      if (groupLogoInputRef.current) groupLogoInputRef.current.value = ''
    }
  }

  const handleGroupLogoDelete = async () => {
    if (!detailGroup) return
    try {
      await groupsApi.deleteLogo(detailGroup.id)
      setDetailGroup({ ...detailGroup, splash_logo: null })
      dispatch(fetchGroups())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const handleGroupStandbyChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !detailGroup) return
    setUploadingGroupStandby(true)
    try {
      const res = await groupsApi.uploadStandby(detailGroup.id, file)
      setDetailGroup({ ...detailGroup, standby_image: res.standby_url })
      dispatch(fetchGroups())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingGroupStandby(false)
      if (groupStandbyInputRef.current) groupStandbyInputRef.current.value = ''
    }
  }

  const handleGroupStandbyDelete = async () => {
    if (!detailGroup) return
    try {
      await groupsApi.deleteStandby(detailGroup.id)
      setDetailGroup({ ...detailGroup, standby_image: null })
      dispatch(fetchGroups())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingGroup(null)
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const data = {
      name: formName,
      color: formColor,
      description: formDescription,
      location: formLocation || null,
    }

    try {
      if (editingGroup) {
        await dispatch(updateGroup({ id: editingGroup.id, data })).unwrap()
      } else {
        await dispatch(createGroup(data)).unwrap()
      }
      Swal.fire({
        icon: 'success',
        title: t('common.success'),
        timer: 1500,
        showConfirmButton: false,
      })
      setShowForm(false)
      setEditingGroup(null)
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="fm-page-header">
        <div>
          <h1 className="page-title">
            <FaLayerGroup className="page-icon" />
            {t('groups.title')}
          </h1>
        </div>
        <div className="page-actions">
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('groups.addGroup')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="fm-loading">
          <div className="spinner" />
        </div>
      ) : groups.length === 0 ? (
        <div className="fm-empty-state">
          <div className="empty-icon">
            <FaLayerGroup />
          </div>
          <h3 className="empty-title">{t('common.noResults')}</h3>
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('groups.addGroup')}
          </button>
        </div>
      ) : (
        <div className="row g-3">
          {groups.map((group) => {
            const groupPlayers = getPlayersInGroup(group.id)
            return (
              <div key={group.id} className="col-sm-6 col-lg-4">
                <div className="fm-card fm-card-accent">
                  <div className="fm-card-header">
                    <div className="d-flex align-items-center gap-2">
                      <span
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '4px',
                          backgroundColor: group.color || '#0082C8',
                          flexShrink: 0,
                        }}
                      />
                      <h5 className="card-title mb-0">{group.name}</h5>
                    </div>
                    <div className="card-actions">
                      <button
                        className="fm-btn-icon"
                        onClick={() => handleOpenRotation(group)}
                        title={t('groups.applyRotation')}
                      >
                        <FaSyncAlt />
                      </button>
                      <button
                        className="fm-btn-icon"
                        onClick={() => handleOpenPushLogo(group)}
                        title={t('branding.pushTitle')}
                      >
                        <FaImage />
                      </button>
                      <button
                        className="fm-btn-icon"
                        onClick={() => handleEdit(group)}
                        title={t('common.edit')}
                      >
                        <FaEdit />
                      </button>
                      <button
                        className="fm-btn-icon"
                        onClick={() => handleDelete(group)}
                        title={t('common.delete')}
                        style={{ color: '#dc3545' }}
                      >
                        <FaTrash />
                      </button>
                    </div>
                  </div>
                  <div className="fm-card-body" style={{ cursor: 'pointer' }} onClick={() => setDetailGroup(group)}>
                    {group.description && (
                      <p className="text-muted mb-2" style={{ fontSize: '0.875rem' }}>
                        {group.description}
                      </p>
                    )}
                    {group.location_detail && (
                      <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>
                        <FaMapMarkerAlt style={{ marginRight: '0.3rem' }} />
                        {group.location_detail.name}
                      </p>
                    )}
                    <div className="d-flex align-items-center gap-2">
                      <span
                        className="fm-group-tag"
                        style={{
                          backgroundColor: group.color ? `${group.color}20` : undefined,
                          color: group.color || undefined,
                        }}
                      >
                        {groupPlayers.length} {t('groups.players')}
                      </span>
                    </div>
                    {groupPlayers.length > 0 && (
                      <div className="mt-2">
                        {groupPlayers.slice(0, 5).map((p) => (
                          <div
                            key={p.id}
                            className="d-flex align-items-center gap-2 py-1"
                            style={{ fontSize: '0.8rem' }}
                          >
                            <span
                              className={`status-dot ${
                                p.is_online ? 'status-online' : 'status-offline'
                              }`}
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: p.is_online ? '#28a745' : '#dc3545',
                                flexShrink: 0,
                              }}
                            />
                            <span className="text-muted">{p.name}</span>
                          </div>
                        ))}
                        {groupPlayers.length > 5 && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0"
                            style={{ fontSize: '0.8rem' }}
                            onClick={(e) => { e.stopPropagation(); setDetailGroup(group) }}
                          >
                            {t('groups.viewAllDevices', { count: groupPlayers.length })}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Group Form Modal */}
      {showForm && (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={handleFormClose}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">
                  {editingGroup ? t('groups.editGroup') : t('groups.addGroup')}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={handleFormClose}
                  aria-label={t('common.close')}
                />
              </div>
              <form onSubmit={handleFormSubmit}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">
                      {t('groups.name')}
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                      placeholder="1st Floor"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">
                      {t('groups.color')}
                    </label>
                    <div className="d-flex align-items-center gap-2">
                      <input
                        type="color"
                        className="form-control form-control-color"
                        value={formColor}
                        onChange={(e) => setFormColor(e.target.value)}
                        style={{ width: '50px', height: '38px' }}
                      />
                      <input
                        type="text"
                        className="form-control"
                        value={formColor}
                        onChange={(e) => setFormColor(e.target.value)}
                        placeholder="#0082C8"
                        style={{ maxWidth: '120px' }}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">
                      {t('groups.description')}
                    </label>
                    <textarea
                      className="form-control"
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      rows={3}
                      placeholder={t('groups.description')}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">
                      {t('groups.location')}
                    </label>
                    <select
                      className="form-select"
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                    >
                      <option value="">{t('groups.noLocation')}</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleFormClose}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="fm-btn-primary"
                    disabled={saving}
                  >
                    {saving ? t('common.loading') : t('common.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Apply rotation modal */}
      {rotationGroup && (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setRotationGroup(null)}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">
                  {t('groups.applyRotation')} — {rotationGroup.name}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setRotationGroup(null)}
                  aria-label={t('common.close')}
                />
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('groups.applyRotationDesc')}</p>
                <div className="d-flex gap-2 flex-wrap">
                  {ROTATION_OPTIONS.map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      className={`btn ${rotationValue === deg ? 'fm-btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setRotationValue(deg)}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRotationGroup(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="fm-btn-primary"
                  onClick={handleApplyRotation}
                  disabled={applyingRotation}
                >
                  {applyingRotation ? t('common.loading') : t('groups.apply')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Push splash logo modal */}
      {pushLogoGroup && (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setPushLogoGroup(null)}
        >
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">
                  {t('branding.pushTitle')} — {pushLogoGroup.name}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setPushLogoGroup(null)}
                  aria-label={t('common.close')}
                />
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('branding.pushDescGroup')}</p>
                <div className="mb-3">
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="group-push-target-logo"
                      checked={pushTargetLogo}
                      onChange={e => setPushTargetLogo(e.target.checked)}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="group-push-target-logo">
                      {t('branding.logoLabel')}
                    </label>
                  </div>
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="group-push-target-standby"
                      checked={pushTargetStandby}
                      onChange={e => setPushTargetStandby(e.target.checked)}
                      disabled={!brandingHasStandby}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="group-push-target-standby">
                      {t('branding.standbyLabel')}
                      {!brandingHasStandby && (
                        <span className="text-muted"> ({t('branding.notSet')})</span>
                      )}
                    </label>
                  </div>
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="group-push-target-theme"
                      checked={pushTargetTheme}
                      onChange={e => setPushTargetTheme(e.target.checked)}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="group-push-target-theme">
                      {t('branding.themeLabel')}
                    </label>
                  </div>
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshUser')}</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={pushLogoSshUser}
                    onChange={e => setPushLogoSshUser(e.target.value)}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshPassword')}</label>
                  <input
                    type="password"
                    className="form-control form-control-sm"
                    value={pushLogoSshPassword}
                    onChange={e => setPushLogoSshPassword(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshPort')}</label>
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    value={pushLogoSshPort}
                    onChange={e => setPushLogoSshPort(Number(e.target.value))}
                    min={1}
                    max={65535}
                    style={{ maxWidth: '120px' }}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setPushLogoGroup(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="fm-btn-primary"
                  onClick={handlePushLogo}
                  disabled={pushingLogo || !pushLogoSshPassword || (!pushTargetLogo && !pushTargetStandby && !pushTargetTheme)}
                >
                  {pushingLogo ? t('common.loading') : t('branding.push')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Group Detail Modal — full device list */}
      {detailGroup && (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setDetailGroup(null)}
        >
          <div
            className="modal-dialog modal-dialog-centered modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <span
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '4px',
                      backgroundColor: detailGroup.color || '#0082C8',
                      flexShrink: 0,
                    }}
                  />
                  {detailGroup.name}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setDetailGroup(null)}
                  aria-label={t('common.close')}
                />
              </div>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {detailGroup.location_detail && (
                  <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
                    <FaMapMarkerAlt style={{ marginRight: '0.3rem' }} />
                    {detailGroup.location_detail.name}
                  </p>
                )}

                <div className="border rounded p-2 mb-3">
                  <p className="fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>
                    <FaImage className="me-1" />
                    {t('branding.groupOverrideTitle')}
                  </p>
                  <div className="row g-2">
                    <div className="col-6">
                      <div className="d-flex align-items-center gap-2">
                        <div
                          className="border rounded d-flex align-items-center justify-content-center p-1"
                          style={{ width: '70px', height: '44px', background: 'var(--bs-tertiary-bg, #f5f5f5)', flexShrink: 0 }}
                        >
                          {detailGroup.splash_logo && (
                            <img src={detailGroup.splash_logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                          )}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          <input ref={groupLogoInputRef} type="file" accept=".svg,.png,.jpg,.jpeg" className="d-none" onChange={handleGroupLogoChange} />
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => groupLogoInputRef.current?.click()} disabled={uploadingGroupLogo} style={{ fontSize: '0.72rem' }}>
                            {t('branding.logoLabel')}
                          </button>
                          {detailGroup.splash_logo && (
                            <button type="button" className="btn btn-sm btn-link p-0 text-danger" onClick={handleGroupLogoDelete} style={{ fontSize: '0.72rem' }}>
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="d-flex align-items-center gap-2">
                        <div
                          className="border rounded d-flex align-items-center justify-content-center p-1"
                          style={{ width: '70px', height: '44px', background: '#000', flexShrink: 0 }}
                        >
                          {detailGroup.standby_image && (
                            <img src={detailGroup.standby_image} alt="Standby" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                          )}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          <input ref={groupStandbyInputRef} type="file" accept=".png,.jpg,.jpeg" className="d-none" onChange={handleGroupStandbyChange} />
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => groupStandbyInputRef.current?.click()} disabled={uploadingGroupStandby} style={{ fontSize: '0.72rem' }}>
                            {t('branding.standbyLabel')}
                          </button>
                          {detailGroup.standby_image && (
                            <button type="button" className="btn btn-sm btn-link p-0 text-danger" onClick={handleGroupStandbyDelete} style={{ fontSize: '0.72rem' }}>
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {getPlayersInGroup(detailGroup.id).length === 0 ? (
                  <p className="text-muted mb-0">{t('common.noResults')}</p>
                ) : (
                  <ul className="list-unstyled mb-0">
                    {getPlayersInGroup(detailGroup.id).map((p) => (
                      <li key={p.id} className="d-flex align-items-center gap-2 py-1">
                        <span
                          className={`status-dot ${p.is_online ? 'status-online' : 'status-offline'}`}
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: p.is_online ? '#28a745' : '#dc3545',
                            flexShrink: 0,
                          }}
                        />
                        <FaDesktop className="text-muted" />
                        {p.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailGroup(null)}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GroupList
