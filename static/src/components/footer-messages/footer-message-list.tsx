import React, { useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FaBullhorn,
  FaPlus,
  FaEdit,
  FaTrash,
  FaDesktop,
  FaLayerGroup,
  FaMapMarkerAlt,
  FaCog,
  FaUpload,
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchPlayers } from '@/store/playersSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchLocations } from '@/store/locationsSlice'
import { footerMessages as footerMessagesApi } from '@/services/api'
import { showToast } from '@/utils/toast'
import { RoleContext, canEditPlaylistTargets, isAdminRole } from '@/components/app'
import type { FooterMessage, FooterSettings } from '@/types'

const FooterMessageList: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const role = useContext(RoleContext)
  const canEditTargets = canEditPlaylistTargets(role)
  const { players } = useAppSelector((state) => state.players)
  const { groups } = useAppSelector((state) => state.groups)
  const { locations } = useAppSelector((state) => state.locations)

  const [messages, setMessages] = useState<FooterMessage[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingMessage, setEditingMessage] = useState<FooterMessage | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formMessage, setFormMessage] = useState('')
  const [formOrder, setFormOrder] = useState(0)
  const [formIsActive, setFormIsActive] = useState(true)
  const [formTargetPlayers, setFormTargetPlayers] = useState<string[]>([])
  const [formTargetGroups, setFormTargetGroups] = useState<string[]>([])
  const [formTargetLocations, setFormTargetLocations] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Fleet-wide settings (admin only) — cycle interval + logo, both
  // global rather than per-message (see the plan's architecture note:
  // one image/interval for the whole fleet, not per player/group/
  // location like splash/standby branding).
  const isAdmin = isAdminRole(role)
  const [footerSettings, setFooterSettings] = useState<FooterSettings | null>(null)
  const [cycleIntervalMinutes, setCycleIntervalMinutes] = useState('0')
  const [savingSettings, setSavingSettings] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const loadMessages = () => {
    setLoading(true)
    footerMessagesApi.list().then(setMessages).catch(() => {}).finally(() => setLoading(false))
  }

  const loadFooterSettings = () => {
    if (!isAdmin) return
    footerMessagesApi.getSettings().then((res) => {
      setFooterSettings(res)
      setCycleIntervalMinutes(String(res.cycle_interval_minutes))
    }).catch(() => {})
  }

  useEffect(() => {
    loadMessages()
    loadFooterSettings()
    dispatch(fetchPlayers())
    dispatch(fetchGroups())
    dispatch(fetchLocations())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch])

  const handleSaveFooterSettings = () => {
    setSavingSettings(true)
    footerMessagesApi.updateSettings(parseInt(cycleIntervalMinutes, 10) || 0).then((res) => {
      setFooterSettings(res)
      setCycleIntervalMinutes(String(res.cycle_interval_minutes))
      showToast('success', t('common.success'))
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setSavingSettings(false))
  }

  const handleUploadLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    footerMessagesApi.uploadLogo(file).then(() => {
      loadFooterSettings()
      showToast('success', t('common.success'))
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => {
      setUploadingLogo(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    })
  }

  const handleDeleteLogo = () => {
    footerMessagesApi.deleteLogo().then(() => {
      loadFooterSettings()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    })
  }

  const resetForm = () => {
    setFormTitle('')
    setFormMessage('')
    setFormOrder(messages.length)
    setFormIsActive(true)
    setFormTargetPlayers([])
    setFormTargetGroups([])
    setFormTargetLocations([])
  }

  const handleAdd = () => {
    setEditingMessage(null)
    resetForm()
    setShowForm(true)
  }

  const handleEdit = (message: FooterMessage) => {
    setEditingMessage(message)
    setFormTitle(message.title)
    setFormMessage(message.message)
    setFormOrder(message.order)
    setFormIsActive(message.is_active)
    setFormTargetPlayers(message.target_players || [])
    setFormTargetGroups(message.target_groups || [])
    setFormTargetLocations(message.target_locations || [])
    setShowForm(true)
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingMessage(null)
  }

  const toggleMultiSelect = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    // Targets are only included when this role is allowed to edit them —
    // omitting the keys entirely (rather than sending the unchanged
    // arrays) matches PlaylistSerializer.validate()'s check, which
    // blocks the request outright if an editor_simplificado's payload
    // touches target_players/groups/locations at all, even with the
    // same values it already had.
    const data: Partial<FooterMessage> = {
      title: formTitle,
      message: formMessage,
      order: formOrder,
      is_active: formIsActive,
      ...(canEditTargets ? {
        target_players: formTargetPlayers,
        target_groups: formTargetGroups,
        target_locations: formTargetLocations,
      } : {}),
    }

    try {
      if (editingMessage) {
        await footerMessagesApi.update(editingMessage.id, data)
      } else {
        await footerMessagesApi.create(data)
      }
      showToast('success', t('common.success'))
      handleFormClose()
      loadMessages()
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (message: FooterMessage) => {
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('footerMessages.confirmDelete'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })
    if (result.isConfirmed) {
      try {
        await footerMessagesApi.delete(message.id)
        loadMessages()
      } catch (error) {
        Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
      }
    }
  }

  return (
    <div>
      <div className="fm-page-header">
        <div>
          <h1 className="page-title">
            <FaBullhorn className="page-icon" />
            {t('footerMessages.title')}
          </h1>
          <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>{t('footerMessages.subtitle')}</p>
        </div>
        <div className="page-actions">
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('footerMessages.addMessage')}
          </button>
        </div>
      </div>

      {isAdmin && (
        <div className="fm-card fm-card-accent mb-3">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaCog className="me-2" />
              {t('footerMessages.settingsTitle')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                  {t('footerMessages.cycleInterval')}
                </label>
                <div className="input-group input-group-sm" style={{ maxWidth: '220px' }}>
                  <input
                    type="number"
                    className="form-control"
                    min={0}
                    value={cycleIntervalMinutes}
                    onChange={(e) => setCycleIntervalMinutes(e.target.value)}
                  />
                  <span className="input-group-text">{t('settings.minutes')}</span>
                </div>
                <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('footerMessages.cycleIntervalHint')}</div>
                <button
                  className="fm-btn-primary btn-sm mt-2"
                  onClick={handleSaveFooterSettings}
                  disabled={savingSettings}
                >
                  {savingSettings ? t('common.loading') : t('common.save')}
                </button>
              </div>

              <div className="col-md-6">
                <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                  {t('footerMessages.logo')}
                </label>
                <div className="form-text mb-2" style={{ fontSize: '0.75rem' }}>{t('footerMessages.logoHint')}</div>
                <div className="d-flex align-items-center gap-2">
                  <div
                    className="border rounded d-flex align-items-center justify-content-center"
                    style={{ width: '64px', height: '64px', background: 'var(--bs-tertiary-bg, #f5f5f5)' }}
                  >
                    {footerSettings?.logo_url ? (
                      <img src={footerSettings.logo_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      <FaBullhorn className="text-muted" />
                    )}
                  </div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept=".png,image/png,.jpg,.jpeg,image/jpeg,.gif,image/gif"
                    className="d-none"
                    onChange={handleUploadLogo}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                  >
                    <FaUpload className="me-1" />
                    {uploadingLogo ? t('common.loading') : t('footerMessages.uploadLogo')}
                  </button>
                  {footerSettings?.has_logo && (
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={handleDeleteLogo}>
                      <FaTrash className="me-1" />
                      {t('common.delete')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="fm-loading"><div className="spinner" /></div>
      ) : messages.length === 0 ? (
        <div className="fm-empty-state">
          <div className="empty-icon"><FaBullhorn /></div>
          <h3 className="empty-title">{t('common.noResults')}</h3>
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('footerMessages.addMessage')}
          </button>
        </div>
      ) : (
        <div className="row g-3">
          {messages.map((message) => (
            <div key={message.id} className="col-sm-6 col-lg-4">
              <div className="fm-card fm-card-accent">
                <div className="fm-card-header">
                  <h5 className="card-title mb-0 text-truncate" title={message.title}>{message.title}</h5>
                  <div className="card-actions">
                    <button className="fm-btn-icon" onClick={() => handleEdit(message)} title={t('common.edit')}>
                      <FaEdit />
                    </button>
                    <button className="fm-btn-icon" onClick={() => handleDelete(message)} title={t('common.delete')} style={{ color: '#dc3545' }}>
                      <FaTrash />
                    </button>
                  </div>
                </div>
                <div className="fm-card-body">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span className={`badge ${message.is_active ? 'bg-success-subtle text-success-emphasis' : 'bg-secondary-subtle text-secondary-emphasis'}`} style={{ fontSize: '0.72rem' }}>
                      {message.is_active ? t('footerMessages.active') : t('footerMessages.inactive')}
                    </span>
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>{t('footerMessages.order')}: {message.order}</span>
                  </div>

                  <p className="text-muted mb-2" style={{ fontSize: '0.8rem', whiteSpace: 'pre-line' }}>
                    {message.message || <em>{t('footerMessages.noMessage')}</em>}
                  </p>

                  <div className="mb-1">
                    <span className="fw-semibold" style={{ fontSize: '0.78rem' }}>{t('playlists.appliedTo')}</span>
                  </div>
                  {!message.target_players_detail?.length && !message.target_groups_detail?.length && !message.target_locations_detail?.length ? (
                    <span className="text-muted" style={{ fontSize: '0.78rem' }}>{t('playlists.noTargets')}</span>
                  ) : (
                    <div className="d-flex flex-wrap gap-1">
                      {message.target_players_detail?.map((p) => (
                        <span key={`p-${p.id}`} className="badge bg-secondary-subtle text-secondary-emphasis d-inline-flex align-items-center gap-1" style={{ fontSize: '0.7rem', fontWeight: 500 }}>
                          <FaDesktop style={{ fontSize: '0.65rem' }} />{p.name}
                        </span>
                      ))}
                      {message.target_groups_detail?.map((g) => (
                        <span key={`g-${g.id}`} className="badge bg-primary-subtle text-primary-emphasis d-inline-flex align-items-center gap-1" style={{ fontSize: '0.7rem', fontWeight: 500 }}>
                          <FaLayerGroup style={{ fontSize: '0.65rem' }} />{g.name}
                        </span>
                      ))}
                      {message.target_locations_detail?.map((l) => (
                        <span key={`l-${l.id}`} className="badge bg-info-subtle text-info-emphasis d-inline-flex align-items-center gap-1" style={{ fontSize: '0.7rem', fontWeight: 500 }}>
                          <FaMapMarkerAlt style={{ fontSize: '0.65rem' }} />{l.name}
                        </span>
                      ))}
                    </div>
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
                  {editingMessage ? t('footerMessages.editMessage') : t('footerMessages.addMessage')}
                </h5>
                <button type="button" className="btn-close" onClick={handleFormClose} aria-label={t('common.close')} />
              </div>
              <form onSubmit={handleFormSubmit}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('footerMessages.titleField')}</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      maxLength={500}
                      required
                    />
                    <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('footerMessages.titleFieldHint')}</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">{t('footerMessages.messageField')}</label>
                    <textarea
                      className="form-control"
                      value={formMessage}
                      onChange={(e) => setFormMessage(e.target.value)}
                      rows={3}
                      maxLength={1000}
                    />
                    <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('footerMessages.messageFieldHint')}</div>
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label fw-semibold">{t('footerMessages.order')}</label>
                      <input
                        type="number"
                        className="form-control"
                        value={formOrder}
                        onChange={(e) => setFormOrder(Number(e.target.value))}
                      />
                    </div>
                    <div className="col-md-6 mb-3 d-flex align-items-end">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={formIsActive}
                          onChange={(e) => setFormIsActive(e.target.checked)}
                          id="footer-message-active"
                        />
                        <label className="form-check-label" htmlFor="footer-message-active">{t('footerMessages.active')}</label>
                      </div>
                    </div>
                  </div>

                  {canEditTargets ? (
                    <div className="row">
                      <div className="col-md-4 mb-3">
                        <label className="form-label fw-semibold d-flex align-items-center gap-1"><FaDesktop />{t('nav.players')}</label>
                        <div className="border rounded p-2" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                          {players.map((p) => (
                            <div className="form-check" key={p.id}>
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={formTargetPlayers.includes(p.id)}
                                onChange={() => toggleMultiSelect(formTargetPlayers, setFormTargetPlayers, p.id)}
                                id={`footer-target-player-${p.id}`}
                              />
                              <label className="form-check-label" htmlFor={`footer-target-player-${p.id}`} style={{ fontSize: '0.85rem' }}>{p.name}</label>
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
                                checked={formTargetGroups.includes(g.id)}
                                onChange={() => toggleMultiSelect(formTargetGroups, setFormTargetGroups, g.id)}
                                id={`footer-target-group-${g.id}`}
                              />
                              <label className="form-check-label" htmlFor={`footer-target-group-${g.id}`} style={{ fontSize: '0.85rem' }}>{g.name}</label>
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
                                checked={formTargetLocations.includes(l.id)}
                                onChange={() => toggleMultiSelect(formTargetLocations, setFormTargetLocations, l.id)}
                                id={`footer-target-location-${l.id}`}
                              />
                              <label className="form-check-label" htmlFor={`footer-target-location-${l.id}`} style={{ fontSize: '0.85rem' }}>{l.name}</label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted" style={{ fontSize: '0.8rem' }}>{t('footerMessages.targetsLockedHint')}</p>
                  )}
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

export default FooterMessageList
