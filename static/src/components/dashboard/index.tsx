import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  FaDesktop,
  FaLayerGroup,
  FaMapMarkerAlt,
  FaPlus,
  FaThLarge,
} from 'react-icons/fa'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchPlayers } from '@/store/playersSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchLocations } from '@/store/locationsSlice'
import ServerTelemetryCard from './server-telemetry'
import FleetStatusPanel from './fleet-status'
import StatusGauge from './status-gauge'
import AddPlayerModal from '../players/add-player-modal'

const Dashboard: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { players } = useAppSelector((state) => state.players)
  const { groups } = useAppSelector((state) => state.groups)
  const { locations } = useAppSelector((state) => state.locations)

  const [showPlayerForm, setShowPlayerForm] = useState(false)

  useEffect(() => {
    dispatch(fetchPlayers())
    dispatch(fetchGroups())
    dispatch(fetchLocations())
  }, [dispatch])

  const stats = useMemo(() => {
    const total = players.length
    const online = players.filter((p) => p.is_online).length
    const offline = total - online
    return { total, online, offline, groups: groups.length, locations: locations.length }
  }, [players, groups, locations])

  const statCards = [
    {
      icon: <FaLayerGroup />,
      iconClass: 'stat-icon-yellow',
      value: stats.groups,
      label: t('dashboard.groups'),
      to: '/groups',
    },
    {
      icon: <FaMapMarkerAlt />,
      iconClass: 'stat-icon-purple',
      value: stats.locations,
      label: t('dashboard.locations'),
      to: '/locations',
    },
  ]

  return (
    <div>
      <div className="fm-page-header">
        <div>
          <h1 className="page-title">
            <FaThLarge className="page-icon" />
            {t('dashboard.title')}
          </h1>
        </div>
        <div className="page-actions">
          <button className="fm-btn-primary" onClick={() => setShowPlayerForm(true)}>
            <FaPlus />
            {t('dashboard.addPlayer')}
          </button>
        </div>
      </div>

      <div className="row g-3 mb-4 align-items-start">
        <div className="col-lg-6 d-flex">
          <div className="d-flex flex-column gap-3 flex-grow-1">
            <StatusGauge online={stats.online} total={stats.total} onClick={() => navigate('/players')} />
            <div className="row g-3 flex-grow-1 align-content-stretch">
              {statCards.map((card, idx) => (
                <div key={idx} className="col-6 d-flex">
                  <div
                    className="fm-stat-card flex-grow-1"
                    role="button"
                    onClick={() => navigate(card.to)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={`stat-icon ${card.iconClass}`}>{card.icon}</div>
                    <div className="stat-content">
                      <div className="stat-value">{card.value}</div>
                      <div className="stat-label">{card.label}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-lg-6">
          <ServerTelemetryCard />
        </div>
      </div>

      {players.length === 0 ? (
        <div className="fm-empty-state">
          <div className="empty-icon">
            <FaDesktop />
          </div>
          <h3 className="empty-title">{t('dashboard.noPlayers')}</h3>
          <p className="empty-text">{t('dashboard.noPlayersDesc')}</p>
          <button className="fm-btn-primary" onClick={() => setShowPlayerForm(true)}>
            <FaPlus />
            {t('dashboard.addPlayer')}
          </button>
        </div>
      ) : (
        <FleetStatusPanel players={players} groups={groups} locations={locations} />
      )}

      {showPlayerForm && (
        <AddPlayerModal
          editingPlayer={null}
          groups={groups}
          locations={locations}
          onClose={() => setShowPlayerForm(false)}
          onSaved={() => {
            setShowPlayerForm(false)
            dispatch(fetchPlayers())
          }}
        />
      )}
    </div>
  )
}

export default Dashboard
