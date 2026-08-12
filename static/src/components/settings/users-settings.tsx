import React, { useState, useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { FaUsers, FaPlus, FaEdit, FaTrash, FaTimes, FaEye, FaMapMarkerAlt, FaLayerGroup, FaDesktop } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { users as usersApi, locations as locationsApi, groups as groupsApi, players as playersApi, audit as auditApi } from '@/services/api'
import { RoleContext, AuthContext, isSuperAdminRole } from '@/components/app'
import type { User, UserRole, Location, Group, Player, AuditLogEntry } from '@/types'

const ROLE_BADGE: Record<UserRole, string> = {
  superadmin: 'bg-dark',
  admin: 'bg-danger',
  editor: 'bg-primary',
  viewer: 'bg-secondary',
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-success',
  upload: 'bg-success',
  update: 'bg-primary',
  update_item: 'bg-primary',
  delete: 'bg-danger',
  deactivate: 'bg-danger',
  login: 'bg-info',
  login_failed: 'bg-warning text-dark',
  logout: 'bg-secondary',
  reboot: 'bg-warning text-dark',
  shutdown: 'bg-warning text-dark',
  deploy: 'bg-info',
  add_item: 'bg-success',
  remove_item: 'bg-danger',
  start: 'bg-success',
  stop: 'bg-danger',
  trigger_update: 'bg-info',
  cec_standby: 'bg-secondary',
  cec_wake: 'bg-info',
  provision: 'bg-purple',
  bulk_provision: 'bg-purple',
  bulk_reboot: 'bg-warning text-dark',
  bulk_shutdown: 'bg-warning text-dark',
}

const UsersSettings: React.FC = () => {
  const { t } = useTranslation()
  const currentRole = useContext(RoleContext)
  const { user: currentUser } = useContext(AuthContext)
  const [userList, setUserList] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [viewUser, setViewUser] = useState<User | null>(null)
  const [viewActivity, setViewActivity] = useState<AuditLogEntry[]>([])
  const [viewActivityLoading, setViewActivityLoading] = useState(false)

  // Form state
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('viewer')
  const [receiveOfflineAlerts, setReceiveOfflineAlerts] = useState(true)
  const [saving, setSaving] = useState(false)

  // Scope pickers (leave all empty = unrestricted access, the default)
  const [allLocations, setAllLocations] = useState<Location[]>([])
  const [allGroups, setAllGroups] = useState<Group[]>([])
  const [allPlayers, setAllPlayers] = useState<Player[]>([])
  const [scopeLocationIds, setScopeLocationIds] = useState<string[]>([])
  const [scopeGroupIds, setScopeGroupIds] = useState<string[]>([])
  const [scopePlayerIds, setScopePlayerIds] = useState<string[]>([])

  const loadUsers = () => {
    usersApi.list().then(setUserList).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadUsers()
    locationsApi.list().then(setAllLocations).catch(() => {})
    groupsApi.list().then(setAllGroups).catch(() => {})
    playersApi.list().then(setAllPlayers).catch(() => {})
  }, [])

  const resetForm = () => {
    setUsername('')
    setEmail('')
    setFirstName('')
    setLastName('')
    setPassword('')
    setRole('viewer')
    setReceiveOfflineAlerts(true)
    setScopeLocationIds([])
    setScopeGroupIds([])
    setScopePlayerIds([])
    setEditUser(null)
  }

  const toggleId = (ids: string[], setIds: (ids: string[]) => void, id: string) => {
    setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  const openCreate = () => {
    resetForm()
    setShowModal(true)
  }

  const openEdit = (u: User) => {
    setEditUser(u)
    setUsername(u.username)
    setEmail(u.email)
    setFirstName(u.first_name)
    setLastName(u.last_name)
    setRole(u.role)
    setPassword('')
    setReceiveOfflineAlerts(u.receive_offline_alerts ?? true)
    setScopeLocationIds(u.scope?.location_ids || [])
    setScopeGroupIds(u.scope?.group_ids || [])
    setScopePlayerIds(u.scope?.player_ids || [])
    setShowModal(true)
  }

  const openView = (u: User) => {
    setViewUser(u)
    setViewActivity([])
    setViewActivityLoading(true)
    auditApi.list({ user: String(u.id), page_size: 10 })
      .then((res) => setViewActivity(res.results))
      .catch(() => {})
      .finally(() => setViewActivityLoading(false))
  }

  const closeView = () => {
    setViewUser(null)
    setViewActivity([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const scopeData = {
        location_ids: scopeLocationIds,
        group_ids: scopeGroupIds,
        player_ids: scopePlayerIds,
      }
      if (editUser) {
        const data: Record<string, unknown> = { username, email, first_name: firstName, last_name: lastName, role, receive_offline_alerts: receiveOfflineAlerts, ...scopeData }
        if (password) data.password = password
        await usersApi.update(editUser.id, data as Parameters<typeof usersApi.update>[1])
        Swal.fire({ icon: 'success', title: t('common.success'), text: t('users.updated'), timer: 1500, showConfirmButton: false })
      } else {
        await usersApi.create({ username, email, password, role, first_name: firstName, last_name: lastName, receive_offline_alerts: receiveOfflineAlerts, ...scopeData })
        Swal.fire({ icon: 'success', title: t('common.success'), text: t('users.created'), timer: 1500, showConfirmButton: false })
      }
      setShowModal(false)
      resetForm()
      loadUsers()
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (u: User) => {
    Swal.fire({
      title: t('users.confirmDeactivate'),
      text: u.username,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
    }).then((result) => {
      if (result.isConfirmed) {
        usersApi.delete(u.id).then(() => {
          loadUsers()
          Swal.fire({ icon: 'success', title: t('users.deactivated'), timer: 1500, showConfirmButton: false })
        }).catch(() => {
          Swal.fire({ icon: 'error', title: t('common.error') })
        })
      }
    })
  }

  const isEditingSelf = !!editUser && !!currentUser && editUser.id === currentUser.id && !isSuperAdminRole(currentRole)

  return (
    <div className="fm-card fm-card-accent h-100">
      <div className="fm-card-header py-2 d-flex justify-content-between align-items-center">
        <h5 className="card-title mb-0">
          <FaUsers className="me-2" />
          {t('users.title')}
        </h5>
        <button className="fm-btn-primary btn-sm" onClick={openCreate}>
          <FaPlus /> {t('users.addUser')}
        </button>
      </div>
      <div className="fm-card-body py-3">
        {loading ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm fm-table mb-0">
              <thead>
                <tr>
                  <th>{t('users.username')}</th>
                  <th>{t('users.email')}</th>
                  <th>{t('users.role')}</th>
                  <th>{t('users.access')}</th>
                  <th>{t('users.lastLogin')}</th>
                  <th>{t('users.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {userList.map((u) => {
                  const scopedCount = (u.scope?.location_ids.length || 0)
                    + (u.scope?.group_ids.length || 0) + (u.scope?.player_ids.length || 0)
                  return (
                  <tr key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
                    <td className="fw-semibold">{u.username}</td>
                    <td>{u.email || '—'}</td>
                    <td>
                      <span className={`badge ${ROLE_BADGE[u.role] || 'bg-secondary'}`}>
                        {t(`users.role_${u.role}`)}
                      </span>
                      {!u.is_active && <span className="badge bg-dark ms-1">{t('users.inactive')}</span>}
                    </td>
                    <td>
                      {scopedCount > 0 ? (
                        <span className="badge bg-info text-dark">{t('users.restrictedAccess', { count: scopedCount })}</span>
                      ) : (
                        <span className="badge bg-light text-muted border">{t('users.fullAccess')}</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {u.last_login ? new Date(u.last_login).toLocaleString() : '—'}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => openView(u)} title={t('users.viewDetails')}>
                        <FaEye />
                      </button>
                      <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(u)} title={t('common.edit')}>
                        <FaEdit />
                      </button>
                      {u.is_active && (u.role !== 'superadmin' || isSuperAdminRole(currentRole)) && (
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(u)} title={t('common.delete')}>
                          <FaTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">{editUser ? t('users.editUser') : t('users.addUser')}</h5>
                <button type="button" className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body">
                  <div className="mb-2">
                    <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.username')}</label>
                    <input className="form-control form-control-sm" value={username} onChange={(e) => setUsername(e.target.value)} required />
                  </div>
                  <div className="mb-2">
                    <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.email')}</label>
                    <input type="email" className="form-control form-control-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="row mb-2">
                    <div className="col">
                      <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.firstName')}</label>
                      <input className="form-control form-control-sm" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </div>
                    <div className="col">
                      <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.lastName')}</label>
                      <input className="form-control form-control-sm" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                  </div>
                  <div className="mb-2">
                    <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>
                      {t('users.password')} {editUser && <span className="text-muted fw-normal">({t('users.leaveBlank')})</span>}
                    </label>
                    <input type="password" className="form-control form-control-sm" value={password} onChange={(e) => setPassword(e.target.value)} required={!editUser} minLength={6} />
                  </div>
                  <div className="mb-2">
                    <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.role')}</label>
                    <select
                      className="form-select form-select-sm"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      disabled={(!!editUser && editUser.role === 'superadmin' && !isSuperAdminRole(currentRole)) || isEditingSelf}
                    >
                      <option value="viewer">{t('users.role_viewer')}</option>
                      <option value="editor">{t('users.role_editor')}</option>
                      <option value="admin">{t('users.role_admin')}</option>
                      {isSuperAdminRole(currentRole) && (
                        <option value="superadmin">{t('users.role_superadmin')}</option>
                      )}
                    </select>
                    {!!editUser && editUser.role === 'superadmin' && !isSuperAdminRole(currentRole) && (
                      <div className="form-text">{t('users.superadminRoleLocked')}</div>
                    )}
                    {isEditingSelf && (
                      <div className="form-text">{t('users.ownAccessLocked')}</div>
                    )}
                  </div>

                  {(role === 'admin' || role === 'superadmin') && (
                    <div className="form-check mb-2">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="receive-offline-alerts"
                        checked={receiveOfflineAlerts}
                        onChange={(e) => setReceiveOfflineAlerts(e.target.checked)}
                      />
                      <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="receive-offline-alerts">
                        {t('users.receiveOfflineAlerts')}
                      </label>
                      <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('users.receiveOfflineAlertsHint')}</div>
                    </div>
                  )}

                  {role !== 'admin' && role !== 'superadmin' && (
                    <fieldset disabled={isEditingSelf}>
                      <hr className="my-3" />
                      <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>
                        {isEditingSelf ? t('users.ownAccessLocked') : t('users.scopeHint')}
                      </p>
                      <div className="mb-2">
                        <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('locations.title')}</label>
                        <div className="border rounded p-2" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {allLocations.length === 0 ? (
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{t('common.noResults')}</span>
                          ) : allLocations.map((l) => (
                            <div className="form-check" key={l.id}>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                id={`scope-loc-${l.id}`}
                                checked={scopeLocationIds.includes(l.id)}
                                onChange={() => toggleId(scopeLocationIds, setScopeLocationIds, l.id)}
                              />
                              <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor={`scope-loc-${l.id}`}>
                                {l.name}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mb-2">
                        <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('groups.title')}</label>
                        <div className="border rounded p-2" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {allGroups.length === 0 ? (
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{t('common.noResults')}</span>
                          ) : allGroups.map((g) => (
                            <div className="form-check" key={g.id}>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                id={`scope-group-${g.id}`}
                                checked={scopeGroupIds.includes(g.id)}
                                onChange={() => toggleId(scopeGroupIds, setScopeGroupIds, g.id)}
                              />
                              <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor={`scope-group-${g.id}`}>
                                {g.name}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mb-2">
                        <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('players.title')}</label>
                        <div className="border rounded p-2" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {allPlayers.length === 0 ? (
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{t('common.noResults')}</span>
                          ) : allPlayers.map((p) => (
                            <div className="form-check" key={p.id}>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                id={`scope-player-${p.id}`}
                                checked={scopePlayerIds.includes(p.id)}
                                onChange={() => toggleId(scopePlayerIds, setScopePlayerIds, p.id)}
                              />
                              <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor={`scope-player-${p.id}`}>
                                {p.name}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </fieldset>
                  )}
                </div>
                <div className="modal-footer py-2">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowModal(false)}>
                    <FaTimes /> {t('common.cancel')}
                  </button>
                  <button type="submit" className="fm-btn-primary btn-sm" disabled={saving}>
                    {saving ? t('common.loading') : t('common.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Read-only detail view */}
      {viewUser && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">{t('users.userDetails')}</h5>
                <button type="button" className="btn-close" onClick={closeView} />
              </div>
              <div className="modal-body">
                <div className="d-flex justify-content-between align-items-start mb-3">
                  <div>
                    <h5 className="mb-1">
                      {(viewUser.first_name || viewUser.last_name)
                        ? `${viewUser.first_name} ${viewUser.last_name}`.trim()
                        : viewUser.username}
                    </h5>
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>@{viewUser.username}</div>
                  </div>
                  <div className="text-end">
                    <div className="mb-1">
                      <span className={`badge ${ROLE_BADGE[viewUser.role] || 'bg-secondary'}`}>
                        {t(`users.role_${viewUser.role}`)}
                      </span>
                    </div>
                    <span className={`badge ${viewUser.is_active ? 'bg-success' : 'bg-dark'}`}>
                      {viewUser.is_active ? t('users.active') : t('users.inactive')}
                    </span>
                  </div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-sm-6">
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t('users.email')}</div>
                    <div>{viewUser.email || '—'}</div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t('users.lastLogin')}</div>
                    <div>{viewUser.last_login ? new Date(viewUser.last_login).toLocaleString() : t('users.neverLoggedIn')}</div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t('users.dateJoined')}</div>
                    <div>{new Date(viewUser.date_joined).toLocaleString()}</div>
                  </div>
                  {(viewUser.role === 'admin' || viewUser.role === 'superadmin') && (
                    <div className="col-sm-6">
                      <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t('users.receiveOfflineAlerts')}</div>
                      <div>{(viewUser.receive_offline_alerts ?? true) ? t('common.yes') : t('common.no')}</div>
                    </div>
                  )}
                </div>

                <hr />
                <h6 className="mb-2">{t('users.accessScope')}</h6>
                {(() => {
                  const locIds = viewUser.scope?.location_ids || []
                  const grpIds = viewUser.scope?.group_ids || []
                  const plrIds = viewUser.scope?.player_ids || []
                  const hasScope = locIds.length > 0 || grpIds.length > 0 || plrIds.length > 0
                  if (!hasScope) {
                    return <span className="badge bg-light text-muted border">{t('users.fullAccess')}</span>
                  }
                  const locNames = locIds.map((id) => allLocations.find((l) => l.id === id)?.name || id)
                  const grpNames = grpIds.map((id) => allGroups.find((g) => g.id === id)?.name || id)
                  const plrNames = plrIds.map((id) => allPlayers.find((p) => p.id === id)?.name || id)
                  return (
                    <div className="d-flex flex-wrap gap-1">
                      {locNames.map((n, i) => (
                        <span key={`l-${i}`} className="badge bg-info text-dark"><FaMapMarkerAlt className="me-1" />{n}</span>
                      ))}
                      {grpNames.map((n, i) => (
                        <span key={`g-${i}`} className="badge bg-primary"><FaLayerGroup className="me-1" />{n}</span>
                      ))}
                      {plrNames.map((n, i) => (
                        <span key={`p-${i}`} className="badge bg-secondary"><FaDesktop className="me-1" />{n}</span>
                      ))}
                    </div>
                  )
                })()}

                <hr />
                <h6 className="mb-2">{t('users.recentActivity')}</h6>
                {viewActivityLoading ? (
                  <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('users.loadingActivity')}</p>
                ) : viewActivity.length === 0 ? (
                  <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('users.noActivity')}</p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm fm-table mb-0">
                      <thead>
                        <tr>
                          <th>{t('audit.time')}</th>
                          <th>{t('audit.action')}</th>
                          <th>{t('audit.target')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewActivity.map((e) => (
                          <tr key={e.id}>
                            <td style={{ fontSize: '0.8rem' }}>{new Date(e.timestamp).toLocaleString()}</td>
                            <td><span className={`badge ${ACTION_COLORS[e.action] || 'bg-secondary'}`}>{e.action}</span></td>
                            <td className="text-truncate" style={{ maxWidth: '200px', fontSize: '0.85rem' }}>
                              {e.target_name || e.target_id || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="text-end mt-2">
                  <Link to="/audit" className="fm-btn-outline btn-sm" onClick={closeView}>
                    {t('users.viewFullAuditLog')}
                  </Link>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={closeView}>
                  <FaTimes /> {t('common.close')}
                </button>
                <button
                  type="button"
                  className="fm-btn-primary btn-sm"
                  onClick={() => { const u = viewUser; closeView(); if (u) openEdit(u) }}
                >
                  <FaEdit /> {t('common.edit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default UsersSettings
