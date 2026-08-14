import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FaInfoCircle, FaSyncAlt, FaEdit, FaTrash, FaChevronDown } from 'react-icons/fa'
import type { Player } from '@/types'
import { players as playersApi } from '@/services/api'
import Swal from 'sweetalert2'

interface PlayerCardProps {
  player: Player
  onEdit?: (player: Player) => void
  onDelete?: (player: Player) => void
  /** Compact layout — just name + status, no url/group/location/orientation
   * rows. Used where that context is already implied (e.g. the Fleet
   * Overview page already groups devices under their location/group). */
  compact?: boolean
}

const PlayerCard: React.FC<PlayerCardProps> = ({ player, onEdit, onDelete, compact }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Collapsed by default on mobile to save vertical space in the list —
  // the d-md-block override below keeps it always expanded on desktop
  // regardless of this state, so this only matters below that breakpoint.
  const [detailsOpen, setDetailsOpen] = useState(false)

  const group = player.group_detail || player.group
  const location = player.effective_location_detail
  const rotation = player.screen_rotation ?? 0
  const isPortrait = rotation === 90 || rotation === 270
  const lastSeen = player.last_seen
    ? new Date(player.last_seen).toLocaleString()
    : '--'

  const handleCardClick = () => {
    navigate(`/players/${player.id}`)
  }

  const handleInfoClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(`/players/${player.id}`)
  }

  const handleRebootClick = async (e: React.MouseEvent) => {
    e.stopPropagation()

    const result = await Swal.fire({
      title: t('players.reboot'),
      text: `${t('common.confirm')}: ${player.name}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('players.reboot'),
      cancelButtonText: t('common.cancel'),
    })

    if (result.isConfirmed) {
      try {
        await playersApi.reboot(player.id)
        Swal.fire({
          icon: 'success',
          title: t('common.success'),
          timer: 1500,
          showConfirmButton: false,
        })
      } catch {
        Swal.fire({
          icon: 'error',
          title: t('common.error'),
        })
      }
    }
  }

  if (compact) {
    return (
      <div className="fm-player-card fm-player-card-compact" onClick={handleCardClick} title={player.name}>
        <span className={`status-dot ${player.is_online ? 'status-online' : 'status-offline'}`} />
        <span className="player-name-compact text-truncate">{player.name}</span>
        {isPortrait && (
          <span
            aria-hidden="true"
            className="flex-shrink-0"
            style={{ width: '7px', height: '11px', border: '1.5px solid currentColor', borderRadius: '1px', opacity: 0.5 }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="fm-player-card" onClick={handleCardClick}>
      <div className="player-card-header">
        <h5 className="player-name">{player.name}</h5>
        <div className="d-flex align-items-center gap-2">
          <span className={player.is_online ? 'fm-badge-online' : 'fm-badge-offline'}>
            {player.is_online ? t('players.online') : t('players.offline')}
          </span>
          <button
            type="button"
            className="fm-btn-icon d-md-none"
            onClick={(e) => { e.stopPropagation(); setDetailsOpen((open) => !open) }}
            title={detailsOpen ? t('common.collapse') : t('common.expand')}
          >
            <FaChevronDown style={{ transform: detailsOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
          </button>
        </div>
      </div>

      <div className={`player-card-body ${detailsOpen ? 'd-block' : 'd-none'} d-md-block`}>
        <div className="player-info-row">
          <span className="info-label">{t('players.url')}</span>
          <span className="info-value" style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player.url}
          </span>
        </div>

        <div className="player-info-row">
          <span className="info-label">{t('players.group')} / {t('locations.title')}</span>
          <span className="info-value d-flex flex-wrap justify-content-end gap-1">
            {group ? (
              <span
                className="fm-group-tag"
                style={{
                  backgroundColor: group.color ? `${group.color}20` : undefined,
                  color: group.color || undefined,
                }}
              >
                {group.name}
              </span>
            ) : (
              <span className="text-muted">{t('players.noGroup')}</span>
            )}
            {location ? (
              <span
                className="fm-group-tag"
                style={{
                  backgroundColor: location.color ? `${location.color}20` : undefined,
                  color: location.color || undefined,
                }}
              >
                {location.name}
              </span>
            ) : (
              <span className="text-muted">{t('players.noLocation')}</span>
            )}
          </span>
        </div>

        <div className="player-info-row">
          <span className="info-label">{t('players.orientation')}</span>
          <span className="info-value d-flex align-items-center gap-1" title={t(`players.rotation${rotation}` as const)}>
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: isPortrait ? '10px' : '16px',
                height: isPortrait ? '16px' : '10px',
                border: '1.5px solid currentColor',
                borderRadius: '2px',
                opacity: 0.75,
              }}
            />
            {t(isPortrait ? 'players.orientationPortrait' : 'players.orientationLandscape')}
          </span>
        </div>

        <div className="player-info-row">
          <span className="info-label">{t('players.status')}</span>
          <span className="info-value">
            <span className="fm-status-indicator">
              <span
                className={`status-dot ${
                  player.is_online ? 'status-online' : 'status-offline'
                }`}
              />
              <span
                className={`status-text ${
                  player.is_online ? 'text-online' : 'text-offline'
                }`}
              >
                {player.is_online ? t('players.online') : t('players.offline')}
              </span>
            </span>
          </span>
        </div>

        <div className="player-info-row">
          <span className="info-label">{t('players.lastSeen')}</span>
          <span className="info-value">{lastSeen}</span>
        </div>
      </div>

      <div className="player-card-footer">
        <button
          className="fm-btn-icon"
          onClick={handleInfoClick}
          title={t('players.info')}
        >
          <FaInfoCircle />
        </button>
        <button
          className="fm-btn-icon"
          onClick={handleRebootClick}
          title={t('players.reboot')}
        >
          <FaSyncAlt />
        </button>
        {onEdit && (
          <button
            className="fm-btn-icon"
            onClick={(e) => { e.stopPropagation(); onEdit(player) }}
            title={t('common.edit')}
          >
            <FaEdit />
          </button>
        )}
        {onDelete && (
          <button
            className="fm-btn-icon"
            onClick={(e) => { e.stopPropagation(); onDelete(player) }}
            title={t('common.delete')}
            style={{ color: '#dc3545' }}
          >
            <FaTrash />
          </button>
        )}
      </div>
    </div>
  )
}

export default PlayerCard
