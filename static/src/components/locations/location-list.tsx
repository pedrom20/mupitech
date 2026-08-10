import React, { useEffect, useState } from 'react'
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
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchLocations, createLocation, updateLocation, deleteLocation } from '@/store/locationsSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchPlayers } from '@/store/playersSlice'
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
