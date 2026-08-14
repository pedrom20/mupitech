import React, { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaPlug, FaEye } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch } from '@/store/index'
import { createPlayer, updatePlayer } from '@/store/playersSlice'
import { players as playersApi, ApiError } from '@/services/api'
import { RoleContext, isAdminRole } from '@/components/app'
import type { Player, Group, Location } from '@/types'

interface PlayerFormProps {
  player: Player | null
  groups: Group[]
  locations: Location[]
  onClose: () => void
  onSaved: (savedPlayer?: Player) => void
  embedded?: boolean
}

const PlayerForm: React.FC<PlayerFormProps> = ({ player, groups, locations, onClose, onSaved, embedded }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const role = useContext(RoleContext)
  const isEditing = player !== null

  const [name, setName] = useState(player?.name || '')
  const [url, setUrl] = useState(player?.url || '')
  const [username, setUsername] = useState(player?.username || '')
  const [password, setPassword] = useState('')
  const [groupId, setGroupId] = useState(
    player?.group_detail?.id || player?.group?.id || '',
  )
  const [locationId, setLocationId] = useState(
    player?.location_detail?.id || player?.location || '',
  )
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const groupHasLocation = !!groups.find((g) => g.id === groupId)?.location

  const handleTestConnection = async () => {
    if (!player) return
    setTesting(true)
    try {
      const result = await playersApi.testConnection(player.id)
      if (result.success) {
        Swal.fire({
          icon: 'success',
          title: t('players.connectionSuccess'),
          timer: 2000,
          showConfirmButton: false,
        })
      } else {
        Swal.fire({
          icon: 'error',
          title: t('players.connectionFailed'),
          text: result.message,
        })
      }
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('players.connectionFailed'),
        text: String(error),
      })
    } finally {
      setTesting(false)
    }
  }

  const handleRevealCredentials = async () => {
    if (!player) return
    const { value: adminPassword } = await Swal.fire({
      title: t('players.revealCredentialsPrompt'),
      input: 'password',
      inputPlaceholder: t('players.yourPassword'),
      showCancelButton: true,
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputValidator: (value) => (value ? undefined : t('players.yourPassword')),
    })
    if (!adminPassword) return

    try {
      const result = await playersApi.revealCredentials(player.id, adminPassword)
      Swal.fire({
        icon: 'info',
        title: t('players.password'),
        html: `<div class="text-start"><strong>${t('players.username')}:</strong> `
          + `<code>${result.username}</code><br><strong>${t('players.password')}:</strong> `
          + `<code style="user-select: all">${result.password}</code></div>`,
      })
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : String(error),
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const data: Record<string, string | null> = {
      name,
      url,
      username,
    }
    // Group/location are only set here on creation — for an existing
    // device they're managed from its own details page (Location & Group
    // tab of the settings modal) so there's a single place that edits
    // them, instead of two forms silently able to disagree.
    if (!isEditing) {
      data.group = groupId || null
      data.location = locationId || null
    }

    if (password) {
      data.password = password
    }

    try {
      let saved: Player
      if (isEditing && player) {
        saved = await dispatch(updatePlayer({ id: player.id, data })).unwrap()
      } else {
        saved = await dispatch(createPlayer(data)).unwrap()
      }
      Swal.fire({
        icon: 'success',
        title: t('common.success'),
        timer: 1500,
        showConfirmButton: false,
      })
      onSaved(saved)
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

  const formContent = (
    <form onSubmit={handleSubmit}>
      <div className="modal-body">
        <div className="mb-3">
          <label className="form-label fw-semibold">
            {t('players.name')}
          </label>
          <input
            type="text"
            className="form-control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Lobby Screen 1"
          />
        </div>

        <div className="mb-3">
          <label className="form-label fw-semibold">
            {t('players.url')}
          </label>
          <input
            type="url"
            className="form-control"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="http://192.168.1.10"
          />
        </div>

        {isEditing ? (
          <div className="mb-3">
            <small className="text-muted">{t('players.groupLocationManagedElsewhere')}</small>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <label className="form-label fw-semibold">
                {t('players.group')}
              </label>
              <select
                className="form-select"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">{t('players.noGroup')}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="form-label fw-semibold">
                {t('players.location')}
              </label>
              <select
                className="form-select"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                disabled={groupHasLocation}
              >
                <option value="">{t('players.noLocation')}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              {groupHasLocation && (
                <small className="text-muted">{t('players.locationFromGroupHint')}</small>
              )}
            </div>
          </>
        )}

        <div className="mb-3">
          <label className="form-label fw-semibold">
            {t('players.username')}
          </label>
          <input
            type="text"
            className="form-control"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
          />
        </div>

        <div className="mb-3">
          <label className="form-label fw-semibold d-flex justify-content-between align-items-center">
            {t('players.password')}
            {isEditing && isAdminRole(role) && player?.username && (
              <button
                type="button"
                className="btn btn-sm btn-link p-0"
                onClick={handleRevealCredentials}
                title={t('players.revealCredentialsPrompt')}
              >
                <FaEye className="me-1" />{t('players.reveal')}
              </button>
            )}
          </label>
          <input
            type="password"
            className="form-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEditing ? '(unchanged)' : ''}
          />
        </div>
      </div>

      <div className="modal-footer d-flex justify-content-between">
        <div>
          {isEditing && (
            <button
              type="button"
              className="fm-btn-outline fm-btn-sm"
              onClick={handleTestConnection}
              disabled={testing}
            >
              <FaPlug />
              {testing ? t('common.loading') : t('players.testConnection')}
            </button>
          )}
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
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
      </div>
    </form>
  )

  if (embedded) {
    return formContent
  }

  return (
    <div
      className="modal d-block"
      tabIndex={-1}
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title fw-bold text-purple-dark">
              {isEditing ? t('players.editPlayer') : t('players.addPlayer')}
            </h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label={t('common.close')}
            />
          </div>
          {formContent}
        </div>
      </div>
    </div>
  )
}

export default PlayerForm
