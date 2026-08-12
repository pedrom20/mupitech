import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { Player, Group, Location } from '@/types'

type StatusView = 'device' | 'group' | 'location'

interface FleetStatusPanelProps {
  players: Player[]
  groups: Group[]
  locations: Location[]
}

interface StatusRow {
  id: string
  name: string
  online: number
  total: number
  to: string
}

function statusColor(pct: number): string {
  if (pct >= 90) return '#28a745'
  if (pct >= 50) return '#ffc107'
  return '#dc3545'
}

const FleetStatusPanel: React.FC<FleetStatusPanelProps> = ({ players, groups, locations }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [view, setView] = useState<StatusView>('device')

  const groupRows = useMemo<StatusRow[]>(() => {
    return groups.map((group) => {
      const inGroup = players.filter((p) => (p.group_detail?.id || p.group?.id) === group.id)
      return {
        id: group.id,
        name: group.name,
        online: inGroup.filter((p) => p.is_online).length,
        total: inGroup.length,
        to: '/groups',
      }
    })
  }, [players, groups])

  const locationRows = useMemo<StatusRow[]>(() => {
    return locations.map((location) => {
      const inLocation = players.filter((p) => p.effective_location_detail?.id === location.id)
      return {
        id: location.id,
        name: location.name,
        online: inLocation.filter((p) => p.is_online).length,
        total: inLocation.length,
        to: '/locations',
      }
    })
  }, [players, locations])

  const deviceRows = useMemo(() => {
    return [...players]
      .sort((a, b) => Number(a.is_online) - Number(b.is_online))
      .slice(0, 8)
  }, [players])

  const rows = view === 'group' ? groupRows : view === 'location' ? locationRows : []

  return (
    <div className="fm-card fm-card-accent">
      <div className="fm-card-header py-2 d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="card-title mb-0">{t('dashboard.fleetStatus')}</h5>
        <div className="btn-group btn-group-sm" role="group">
          <button
            type="button"
            className={`btn ${view === 'device' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setView('device')}
          >
            {t('nav.players')}
          </button>
          <button
            type="button"
            className={`btn ${view === 'group' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setView('group')}
          >
            {t('nav.groups')}
          </button>
          <button
            type="button"
            className={`btn ${view === 'location' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setView('location')}
          >
            {t('nav.locations')}
          </button>
        </div>
      </div>
      <div className="fm-card-body py-2">
        {view === 'device' ? (
          deviceRows.length === 0 ? (
            <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>{t('common.noResults')}</p>
          ) : (
            <div className="d-flex flex-column gap-2">
              {deviceRows.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  className="d-flex align-items-center gap-2"
                  onClick={() => navigate(`/players/${p.id}`)}
                  style={{ cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  <span
                    style={{
                      width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
                      background: p.is_online ? '#28a745' : '#dc3545',
                    }}
                  />
                  <span className="text-truncate flex-grow-1">{p.name}</span>
                  <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {p.is_online ? t('dashboard.online') : t('dashboard.offline')}
                  </span>
                </div>
              ))}
              {players.length > deviceRows.length && (
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 align-self-start"
                  onClick={() => navigate('/players')}
                >
                  {t('dashboard.viewAllPlayers')}
                </button>
              )}
            </div>
          )
        ) : rows.length === 0 ? (
          <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>{t('common.noResults')}</p>
        ) : (
          <div className="d-flex flex-column gap-2">
            {rows.map((row) => {
              const pct = row.total > 0 ? Math.round((row.online / row.total) * 100) : 0
              return (
                <div
                  key={row.id}
                  role="button"
                  onClick={() => navigate(row.to)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <span className="text-truncate" style={{ fontSize: '0.85rem' }}>{row.name}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                      {row.online}/{row.total}
                    </span>
                  </div>
                  <div className="progress" style={{ height: '6px' }}>
                    <div
                      className="progress-bar"
                      style={{ width: `${pct}%`, background: statusColor(pct) }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default FleetStatusPanel
