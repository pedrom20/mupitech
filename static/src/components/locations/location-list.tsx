import React, { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FaMapMarkerAlt,
  FaPlus,
  FaEdit,
  FaTrash,
  FaLayerGroup,
  FaDesktop,
  FaSitemap,
  FaCircle,
  FaImage,
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchLocations, createLocation, updateLocation, deleteLocation } from '@/store/locationsSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchPlayers } from '@/store/playersSlice'
import { locations as locationsApi } from '@/services/api'
import { isVideoUrl } from '@/utils/media'
import type { Location } from '@/types'

const LocationList: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { locations, loading } = useAppSelector((state) => state.locations)
  const { groups } = useAppSelector((state) => state.groups)
  const { players } = useAppSelector((state) => state.players)

  const [showForm, setShowForm] = useState(false)
  const [editingLocation, setEditingLocation] = useState<Location | null>(null)
  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState('#005096')
  const [formDescription, setFormDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [detailLocation, setDetailLocation] = useState<Location | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [uploadingLocationLogo, setUploadingLocationLogo] = useState(false)
  const [uploadingLocationStandby, setUploadingLocationStandby] = useState(false)
  const locationLogoInputRef = useRef<HTMLInputElement>(null)
  const locationStandbyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    dispatch(fetchLocations())
    dispatch(fetchGroups())
    dispatch(fetchPlayers())
  }, [dispatch])

  const getGroupsInLocation = (locationId: string) => {
    return groups.filter((g) => g.location === locationId)
  }

  const getUngroupedPlayersInLocation = (locationId: string) => {
    return players.filter((p) => !p.group && p.location_detail?.id === locationId)
  }

  const getPlayersInGroup = (groupId: string) => {
    return players.filter((p) => p.group?.id === groupId)
  }

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  const handleLocationLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !detailLocation) return
    setUploadingLocationLogo(true)
    try {
      const res = await locationsApi.uploadLogo(detailLocation.id, file)
      setDetailLocation({ ...detailLocation, splash_logo: res.logo_url })
      dispatch(fetchLocations())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingLocationLogo(false)
      if (locationLogoInputRef.current) locationLogoInputRef.current.value = ''
    }
  }

  const handleLocationLogoDelete = async () => {
    if (!detailLocation) return
    try {
      await locationsApi.deleteLogo(detailLocation.id)
      setDetailLocation({ ...detailLocation, splash_logo: null })
      dispatch(fetchLocations())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const handleLocationStandbyChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !detailLocation) return
    setUploadingLocationStandby(true)
    try {
      const res = await locationsApi.uploadStandby(detailLocation.id, file)
      setDetailLocation({ ...detailLocation, standby_image: res.standby_url })
      dispatch(fetchLocations())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingLocationStandby(false)
      if (locationStandbyInputRef.current) locationStandbyInputRef.current.value = ''
    }
  }

  const handleLocationStandbyDelete = async () => {
    if (!detailLocation) return
    try {
      await locationsApi.deleteStandby(detailLocation.id)
      setDetailLocation({ ...detailLocation, standby_image: null })
      dispatch(fetchLocations())
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const handleAdd = () => {
    setEditingLocation(null)
    setFormName('')
    setFormColor('#005096')
    setFormDescription('')
    setShowForm(true)
  }

  const handleEdit = (location: Location) => {
    setEditingLocation(location)
    setFormName(location.name)
    setFormColor(location.color || '#005096')
    setFormDescription(location.description || '')
    setShowForm(true)
  }

  const handleDelete = async (location: Location) => {
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('locations.confirmDelete'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })

    if (result.isConfirmed) {
      try {
        await dispatch(deleteLocation(location.id)).unwrap()
        Swal.fire({
          icon: 'success',
          title: t('locations.deleted'),
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

  const handleFormClose = () => {
    setShowForm(false)
    setEditingLocation(null)
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const data = {
      name: formName,
      color: formColor,
      description: formDescription,
    }

    try {
      if (editingLocation) {
        await dispatch(updateLocation({ id: editingLocation.id, data })).unwrap()
      } else {
        await dispatch(createLocation(data)).unwrap()
      }
      Swal.fire({
        icon: 'success',
        title: t('common.success'),
        timer: 1500,
        showConfirmButton: false,
      })
      setShowForm(false)
      setEditingLocation(null)
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
            <FaMapMarkerAlt className="page-icon" />
            {t('locations.title')}
          </h1>
        </div>
        <div className="page-actions">
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('locations.addLocation')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="fm-loading">
          <div className="spinner" />
        </div>
      ) : locations.length === 0 ? (
        <div className="fm-empty-state">
          <div className="empty-icon">
            <FaMapMarkerAlt />
          </div>
          <h3 className="empty-title">{t('common.noResults')}</h3>
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('locations.addLocation')}
          </button>
        </div>
      ) : (
        <div className="row g-3">
          {locations.map((location) => {
            const locationGroups = getGroupsInLocation(location.id)
            const ungroupedPlayers = getUngroupedPlayersInLocation(location.id)
            return (
              <div key={location.id} className="col-sm-6 col-lg-4">
                <div className="fm-card fm-card-accent">
                  <div className="fm-card-header">
                    <div className="d-flex align-items-center gap-2">
                      <span
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '4px',
                          backgroundColor: location.color || '#005096',
                          flexShrink: 0,
                        }}
                      />
                      <h5 className="card-title mb-0">{location.name}</h5>
                    </div>
                    <div className="card-actions">
                      <button
                        className="fm-btn-icon"
                        onClick={() => setDetailLocation(location)}
                        title={t('locations.viewDetails')}
                      >
                        <FaSitemap />
                      </button>
                      <button
                        className="fm-btn-icon"
                        onClick={() => handleEdit(location)}
                        title={t('common.edit')}
                      >
                        <FaEdit />
                      </button>
                      <button
                        className="fm-btn-icon"
                        onClick={() => handleDelete(location)}
                        title={t('common.delete')}
                        style={{ color: '#dc3545' }}
                      >
                        <FaTrash />
                      </button>
                    </div>
                  </div>
                  <div className="fm-card-body" style={{ cursor: 'pointer' }} onClick={() => setDetailLocation(location)}>
                    {location.description && (
                      <p className="text-muted mb-2" style={{ fontSize: '0.875rem' }}>
                        {location.description}
                      </p>
                    )}
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span className="fm-group-tag">
                        <FaLayerGroup style={{ marginRight: '0.3rem' }} />
                        {locationGroups.length} {t('locations.groups')}
                      </span>
                      <span className="fm-group-tag">
                        <FaDesktop style={{ marginRight: '0.3rem' }} />
                        {ungroupedPlayers.length} {t('locations.ungroupedPlayers')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Location Form Modal */}
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
                  {editingLocation ? t('locations.editLocation') : t('locations.addLocation')}
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
                      {t('locations.name')}
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                      placeholder="Odemira"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">
                      {t('locations.color')}
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
                        placeholder="#005096"
                        style={{ maxWidth: '120px' }}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">
                      {t('locations.description')}
                    </label>
                    <textarea
                      className="form-control"
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      rows={3}
                      placeholder={t('locations.description')}
                    />
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

      {/* Location Detail Modal — tree of groups/devices */}
      {detailLocation && (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setDetailLocation(null)}
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
                      backgroundColor: detailLocation.color || '#005096',
                      flexShrink: 0,
                    }}
                  />
                  {detailLocation.name}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setDetailLocation(null)}
                  aria-label={t('common.close')}
                />
              </div>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                <div className="border rounded p-2 mb-3">
                  <p className="fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>
                    <FaImage className="me-1" />
                    {t('branding.locationOverrideTitle')}
                  </p>
                  <div className="row g-2">
                    <div className="col-6">
                      <div className="d-flex align-items-center gap-2">
                        <div
                          className="border rounded d-flex align-items-center justify-content-center p-1"
                          style={{ width: '70px', height: '44px', background: 'var(--bs-tertiary-bg, #f5f5f5)', flexShrink: 0 }}
                        >
                          {detailLocation.splash_logo && (
                            <img src={detailLocation.splash_logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                          )}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          <input ref={locationLogoInputRef} type="file" accept=".svg,.png,.jpg,.jpeg" className="d-none" onChange={handleLocationLogoChange} />
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => locationLogoInputRef.current?.click()} disabled={uploadingLocationLogo} style={{ fontSize: '0.72rem' }}>
                            {t('branding.logoLabel')}
                          </button>
                          {detailLocation.splash_logo && (
                            <button type="button" className="btn btn-sm btn-link p-0 text-danger" onClick={handleLocationLogoDelete} style={{ fontSize: '0.72rem' }}>
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
                          {detailLocation.standby_image && (
                            isVideoUrl(detailLocation.standby_image) ? (
                              <video src={detailLocation.standby_image} autoPlay muted loop playsInline style={{ maxWidth: '100%', maxHeight: '100%' }} />
                            ) : (
                              <img src={detailLocation.standby_image} alt="Standby" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                            )
                          )}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          <input ref={locationStandbyInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.mp4,.webm" className="d-none" onChange={handleLocationStandbyChange} />
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => locationStandbyInputRef.current?.click()} disabled={uploadingLocationStandby} style={{ fontSize: '0.72rem' }}>
                            {t('branding.standbyLabel')}
                          </button>
                          {detailLocation.standby_image && (
                            <button type="button" className="btn btn-sm btn-link p-0 text-danger" onClick={handleLocationStandbyDelete} style={{ fontSize: '0.72rem' }}>
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {getGroupsInLocation(detailLocation.id).length === 0
                  && getUngroupedPlayersInLocation(detailLocation.id).length === 0 ? (
                  <p className="text-muted mb-0">{t('common.noResults')}</p>
                ) : (
                  <>
                    {getGroupsInLocation(detailLocation.id).map((group) => {
                      const groupPlayers = getPlayersInGroup(group.id)
                      const isCollapsed = collapsedGroups[group.id]
                      return (
                        <div key={group.id} className="mb-2">
                          <div
                            className="d-flex align-items-center gap-2 p-2 rounded"
                            style={{ background: 'var(--bs-tertiary-bg, #f5f5f5)', cursor: 'pointer' }}
                            onClick={() => toggleGroupCollapsed(group.id)}
                          >
                            <FaLayerGroup style={{ color: group.color || '#0082C8' }} />
                            <strong>{group.name}</strong>
                            <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                              ({groupPlayers.length})
                            </span>
                          </div>
                          {!isCollapsed && (
                            <ul className="list-unstyled ps-4 mt-2 mb-0">
                              {groupPlayers.length === 0 ? (
                                <li className="text-muted" style={{ fontSize: '0.85rem' }}>
                                  {t('locations.noDevices')}
                                </li>
                              ) : (
                                groupPlayers.map((p) => (
                                  <li key={p.id} className="d-flex align-items-center gap-2 py-1">
                                    <FaCircle
                                      style={{
                                        fontSize: '0.5rem',
                                        color: p.is_online ? '#2ecc71' : '#adb5bd',
                                      }}
                                    />
                                    <FaDesktop className="text-muted" />
                                    {p.name}
                                  </li>
                                ))
                              )}
                            </ul>
                          )}
                        </div>
                      )
                    })}

                    {getUngroupedPlayersInLocation(detailLocation.id).length > 0 && (
                      <div className="mb-2">
                        <div
                          className="d-flex align-items-center gap-2 p-2 rounded"
                          style={{ background: 'var(--bs-tertiary-bg, #f5f5f5)' }}
                        >
                          <FaDesktop className="text-muted" />
                          <strong>{t('locations.ungroupedPlayers')}</strong>
                          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                            ({getUngroupedPlayersInLocation(detailLocation.id).length})
                          </span>
                        </div>
                        <ul className="list-unstyled ps-4 mt-2 mb-0">
                          {getUngroupedPlayersInLocation(detailLocation.id).map((p) => (
                            <li key={p.id} className="d-flex align-items-center gap-2 py-1">
                              <FaCircle
                                style={{
                                  fontSize: '0.5rem',
                                  color: p.is_online ? '#2ecc71' : '#adb5bd',
                                }}
                              />
                              <FaDesktop className="text-muted" />
                              {p.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailLocation(null)}>
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

export default LocationList
