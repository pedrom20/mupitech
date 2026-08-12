import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Swal from 'sweetalert2'
import { FaMapMarkerAlt, FaLayerGroup, FaChevronDown, FaChevronRight, FaDesktop, FaEdit, FaPlus, FaArrowsAlt } from 'react-icons/fa'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchLocations, createLocation } from '@/store/locationsSlice'
import { fetchGroups, createGroup, updateGroup } from '@/store/groupsSlice'
import { fetchPlayers } from '@/store/playersSlice'
import { players as playersApi } from '@/services/api'
import { showToast } from '@/utils/toast'
import PlayerCard from '@/components/dashboard/player-card'
import type { Group, Player } from '@/types'

const NO_LOCATION = '__no_location__'

const FleetOverview: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { locations, loading: locationsLoading } = useAppSelector((s) => s.locations)
  const { groups, loading: groupsLoading } = useAppSelector((s) => s.groups)
  const { players, loading: playersLoading } = useAppSelector((s) => s.players)

  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [initialized, setInitialized] = useState(false)

  // Create Location
  const [showLocationForm, setShowLocationForm] = useState(false)
  const [locationFormName, setLocationFormName] = useState('')
  const [locationFormColor, setLocationFormColor] = useState('#005096')
  const [locationFormDescription, setLocationFormDescription] = useState('')
  const [savingLocation, setSavingLocation] = useState(false)

  // Create Group
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupFormName, setGroupFormName] = useState('')
  const [groupFormColor, setGroupFormColor] = useState('#0082C8')
  const [groupFormDescription, setGroupFormDescription] = useState('')
  const [groupFormLocation, setGroupFormLocation] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)

  // Move group to a different location
  const [moveGroup, setMoveGroup] = useState<Group | null>(null)
  const [moveGroupLocationId, setMoveGroupLocationId] = useState('')
  const [savingMoveGroup, setSavingMoveGroup] = useState(false)

  // Move device to a different group/location
  const [moveDevice, setMoveDevice] = useState<Player | null>(null)
  const [moveDeviceGroupId, setMoveDeviceGroupId] = useState('')
  const [moveDeviceLocationId, setMoveDeviceLocationId] = useState('')
  const [savingMoveDevice, setSavingMoveDevice] = useState(false)

  useEffect(() => {
    dispatch(fetchLocations())
    dispatch(fetchGroups())
    dispatch(fetchPlayers())
  }, [dispatch])

  // Start fully expanded once data arrives, so the overview is useful at
  // a glance — collapsing is still available per-section afterwards.
  useEffect(() => {
    if (initialized || locationsLoading || groupsLoading || playersLoading) return
    setExpandedLocations(new Set([...locations.map((l) => l.id), NO_LOCATION]))
    setExpandedGroups(new Set(groups.map((g) => g.id)))
    setInitialized(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationsLoading, groupsLoading, playersLoading])

  const toggleLocation = (id: string) => {
    setExpandedLocations((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingLocation(true)
    try {
      const created = await dispatch(createLocation({
        name: locationFormName,
        color: locationFormColor,
        description: locationFormDescription,
      })).unwrap()
      setExpandedLocations((prev) => new Set(prev).add(created.id))
      setShowLocationForm(false)
      setLocationFormName('')
      setLocationFormColor('#005096')
      setLocationFormDescription('')
      showToast('success', t('common.success'))
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setSavingLocation(false)
    }
  }

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingGroup(true)
    try {
      const created = await dispatch(createGroup({
        name: groupFormName,
        color: groupFormColor,
        description: groupFormDescription,
        location: groupFormLocation || null,
      })).unwrap()
      setExpandedGroups((prev) => new Set(prev).add(created.id))
      setExpandedLocations((prev) => new Set(prev).add(groupFormLocation || NO_LOCATION))
      setShowGroupForm(false)
      setGroupFormName('')
      setGroupFormColor('#0082C8')
      setGroupFormDescription('')
      setGroupFormLocation('')
      showToast('success', t('common.success'))
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setSavingGroup(false)
    }
  }

  const handleOpenMoveGroup = (group: Group) => {
    setMoveGroup(group)
    setMoveGroupLocationId(group.location || '')
  }

  const handleSaveMoveGroup = async () => {
    if (!moveGroup) return
    setSavingMoveGroup(true)
    try {
      await dispatch(updateGroup({ id: moveGroup.id, data: { location: moveGroupLocationId || null } })).unwrap()
      setExpandedLocations((prev) => new Set(prev).add(moveGroupLocationId || NO_LOCATION))
      setMoveGroup(null)
      showToast('success', t('common.success'))
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setSavingMoveGroup(false)
    }
  }

  const handleOpenMoveDevice = (player: Player) => {
    setMoveDevice(player)
    setMoveDeviceGroupId(player.group_detail?.id || player.group?.id || '')
    setMoveDeviceLocationId(player.location_detail?.id || player.location || '')
  }

  const handleSaveMoveDevice = async () => {
    if (!moveDevice) return
    setSavingMoveDevice(true)
    try {
      await playersApi.partialUpdate(moveDevice.id, {
        group: moveDeviceGroupId || null,
        location: moveDeviceLocationId || null,
      } as unknown as Partial<Player>)
      dispatch(fetchPlayers())
      setExpandedGroups((prev) => (moveDeviceGroupId ? new Set(prev).add(moveDeviceGroupId) : prev))
      setExpandedLocations((prev) => new Set(prev).add(moveDeviceLocationId || NO_LOCATION))
      setMoveDevice(null)
      showToast('success', t('common.success'))
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setSavingMoveDevice(false)
    }
  }

  const groupsForLocation = (locationId: string | null) =>
    groups.filter((g) => (locationId === null ? !g.location : g.location === locationId))

  const standaloneDevicesForLocation = (locationId: string | null) =>
    players.filter((p) => !p.group && (locationId === null ? !p.location : p.location === locationId))

  const devicesForGroup = (groupId: string) =>
    players.filter((p) => p.group?.id === groupId)

  const renderGroupSection = (group: Group) => {
    const devices = devicesForGroup(group.id)
    const isExpanded = expandedGroups.has(group.id)
    return (
      <div key={group.id} className="border rounded mb-2">
        <div
          className="d-flex align-items-center gap-2 p-2"
          style={{ cursor: 'pointer', background: 'var(--bs-tertiary-bg, #f8f9fa)' }}
          onClick={() => toggleGroup(group.id)}
        >
          {isExpanded ? <FaChevronDown style={{ fontSize: '0.75rem' }} /> : <FaChevronRight style={{ fontSize: '0.75rem' }} />}
          <FaLayerGroup style={{ color: group.color || undefined }} />
          <span className="fw-semibold">{group.name}</span>
          <span className="badge bg-secondary">{devices.length}</span>
          <button
            type="button"
            className="btn btn-sm btn-link p-0 ms-auto"
            onClick={(e) => { e.stopPropagation(); handleOpenMoveGroup(group) }}
            title={t('fleetOverview.moveGroup')}
          >
            <FaArrowsAlt />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-link p-0"
            onClick={(e) => { e.stopPropagation(); navigate('/groups') }}
            title={t('fleetOverview.editGroup')}
          >
            <FaEdit />
          </button>
        </div>
        {isExpanded && (
          <div className="p-2">
            {devices.length === 0 ? (
              <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>{t('fleetOverview.noDevices')}</p>
            ) : (
              <div className="row g-3">
                {devices.map((player: Player) => renderDeviceCard(player))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderDeviceCard = (player: Player) => (
    <div key={player.id} className="col-sm-6 col-lg-4 col-xl-3 position-relative">
      <PlayerCard player={player} />
      <button
        type="button"
        className="btn btn-sm btn-light border shadow-sm"
        style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', zIndex: 2, padding: '0.2rem 0.4rem' }}
        onClick={(e) => { e.stopPropagation(); handleOpenMoveDevice(player) }}
        title={t('fleetOverview.moveDevice')}
      >
        <FaArrowsAlt style={{ fontSize: '0.75rem' }} />
      </button>
    </div>
  )

  const renderStandaloneDevices = (locationId: string | null) => {
    const devices = standaloneDevicesForLocation(locationId)
    if (devices.length === 0) return null
    return (
      <div className="row g-3 mb-2">
        {devices.map((player) => renderDeviceCard(player))}
      </div>
    )
  }

  const renderLocationSection = (locationId: string | null, name: string, color?: string) => {
    const key = locationId ?? NO_LOCATION
    const isExpanded = expandedLocations.has(key)
    const groupsHere = groupsForLocation(locationId)
    const standaloneDevices = standaloneDevicesForLocation(locationId)
    const totalDevices = standaloneDevices.length + groupsHere.reduce((sum, g) => sum + devicesForGroup(g.id).length, 0)

    return (
      <div key={key} className="fm-card fm-card-accent mb-3">
        <div
          className="fm-card-header d-flex align-items-center gap-2"
          style={{ cursor: 'pointer' }}
          onClick={() => toggleLocation(key)}
        >
          {isExpanded ? <FaChevronDown /> : <FaChevronRight />}
          <FaMapMarkerAlt style={{ color: color || undefined }} />
          <h5 className="card-title mb-0">{name}</h5>
          <span className="badge bg-secondary">{groupsHere.length} {t('nav.groups')}</span>
          <span className="badge bg-secondary">{totalDevices} {t('nav.players')}</span>
          {locationId && (
            <button
              type="button"
              className="btn btn-sm btn-link p-0 ms-auto"
              onClick={(e) => { e.stopPropagation(); navigate('/locations') }}
              title={t('fleetOverview.editLocation')}
            >
              <FaEdit />
            </button>
          )}
        </div>
        {isExpanded && (
          <div className="fm-card-body">
            {groupsHere.length === 0 && standaloneDevices.length === 0 ? (
              <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>{t('fleetOverview.empty')}</p>
            ) : (
              <>
                {groupsHere.map(renderGroupSection)}
                {renderStandaloneDevices(locationId)}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  const loading = locationsLoading || groupsLoading || playersLoading

  return (
    <div>
      <div className="fm-page-header">
        <div>
          <h1 className="page-title">
            <FaDesktop className="page-icon" />
            {t('fleetOverview.title')}
          </h1>
          <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>{t('fleetOverview.description')}</p>
        </div>
        <div className="page-actions d-flex gap-2">
          <button className="fm-btn-outline" onClick={() => setShowGroupForm(true)}>
            <FaPlus />
            {t('groups.addGroup')}
          </button>
          <button className="fm-btn-primary" onClick={() => setShowLocationForm(true)}>
            <FaPlus />
            {t('locations.addLocation')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="fm-loading"><div className="spinner" /></div>
      ) : (
        <>
          {locations.map((loc) => renderLocationSection(loc.id, loc.name, loc.color))}
          {(groupsForLocation(null).length > 0 || standaloneDevicesForLocation(null).length > 0) &&
            renderLocationSection(null, t('fleetOverview.noLocation'))}
        </>
      )}

      {/* Create Location */}
      {showLocationForm && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowLocationForm(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">{t('locations.addLocation')}</h5>
                <button type="button" className="btn-close" onClick={() => setShowLocationForm(false)} aria-label={t('common.close')} />
              </div>
              <form onSubmit={handleCreateLocation}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('locations.name')}</label>
                    <input type="text" className="form-control" value={locationFormName} onChange={(e) => setLocationFormName(e.target.value)} required />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('locations.color')}</label>
                    <div className="d-flex align-items-center gap-2">
                      <input type="color" className="form-control form-control-color" value={locationFormColor} onChange={(e) => setLocationFormColor(e.target.value)} style={{ width: '50px', height: '38px' }} />
                      <input type="text" className="form-control" value={locationFormColor} onChange={(e) => setLocationFormColor(e.target.value)} style={{ maxWidth: '120px' }} />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('locations.description')}</label>
                    <textarea className="form-control" value={locationFormDescription} onChange={(e) => setLocationFormDescription(e.target.value)} rows={3} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowLocationForm(false)}>{t('common.cancel')}</button>
                  <button type="submit" className="fm-btn-primary" disabled={savingLocation}>{savingLocation ? t('common.loading') : t('common.save')}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Create Group */}
      {showGroupForm && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowGroupForm(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">{t('groups.addGroup')}</h5>
                <button type="button" className="btn-close" onClick={() => setShowGroupForm(false)} aria-label={t('common.close')} />
              </div>
              <form onSubmit={handleCreateGroup}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('groups.name')}</label>
                    <input type="text" className="form-control" value={groupFormName} onChange={(e) => setGroupFormName(e.target.value)} required />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('groups.color')}</label>
                    <div className="d-flex align-items-center gap-2">
                      <input type="color" className="form-control form-control-color" value={groupFormColor} onChange={(e) => setGroupFormColor(e.target.value)} style={{ width: '50px', height: '38px' }} />
                      <input type="text" className="form-control" value={groupFormColor} onChange={(e) => setGroupFormColor(e.target.value)} style={{ maxWidth: '120px' }} />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('groups.description')}</label>
                    <textarea className="form-control" value={groupFormDescription} onChange={(e) => setGroupFormDescription(e.target.value)} rows={3} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('groups.location')}</label>
                    <select className="form-select" value={groupFormLocation} onChange={(e) => setGroupFormLocation(e.target.value)}>
                      <option value="">{t('groups.noLocation')}</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowGroupForm(false)}>{t('common.cancel')}</button>
                  <button type="submit" className="fm-btn-primary" disabled={savingGroup}>{savingGroup ? t('common.loading') : t('common.save')}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Move Group to a different location */}
      {moveGroup && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setMoveGroup(null)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">{t('fleetOverview.moveGroupTitle', { name: moveGroup.name })}</h5>
                <button type="button" className="btn-close" onClick={() => setMoveGroup(null)} aria-label={t('common.close')} />
              </div>
              <div className="modal-body">
                <label className="form-label fw-semibold">{t('groups.location')}</label>
                <select className="form-select" value={moveGroupLocationId} onChange={(e) => setMoveGroupLocationId(e.target.value)}>
                  <option value="">{t('groups.noLocation')}</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setMoveGroup(null)}>{t('common.cancel')}</button>
                <button type="button" className="fm-btn-primary" onClick={handleSaveMoveGroup} disabled={savingMoveGroup}>
                  {savingMoveGroup ? t('common.loading') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Move Device to a different group/location */}
      {moveDevice && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setMoveDevice(null)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">{t('fleetOverview.moveDeviceTitle', { name: moveDevice.name })}</h5>
                <button type="button" className="btn-close" onClick={() => setMoveDevice(null)} aria-label={t('common.close')} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">{t('players.group')}</label>
                  <select className="form-select" value={moveDeviceGroupId} onChange={(e) => setMoveDeviceGroupId(e.target.value)}>
                    <option value="">{t('players.noGroup')}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label fw-semibold">{t('players.location')}</label>
                  <select
                    className="form-select"
                    value={moveDeviceLocationId}
                    onChange={(e) => setMoveDeviceLocationId(e.target.value)}
                    disabled={!!groups.find((g) => g.id === moveDeviceGroupId)?.location}
                  >
                    <option value="">{t('players.noLocation')}</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                  {!!groups.find((g) => g.id === moveDeviceGroupId)?.location && (
                    <small className="text-muted">{t('players.locationFromGroupHint')}</small>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setMoveDevice(null)}>{t('common.cancel')}</button>
                <button type="button" className="fm-btn-primary" onClick={handleSaveMoveDevice} disabled={savingMoveDevice}>
                  {savingMoveDevice ? t('common.loading') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FleetOverview
