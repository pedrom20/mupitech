import React, { useEffect, useState, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import {
  FaDesktop,
  FaPlus,
  FaSearch,
  FaEdit,
  FaTrash,
  FaNetworkWired,
  FaThLarge,
  FaTable,
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { useAppDispatch, useAppSelector } from '@/store/index'
import { fetchPlayers, deletePlayer } from '@/store/playersSlice'
import { fetchGroups } from '@/store/groupsSlice'
import { fetchLocations } from '@/store/locationsSlice'
import AddPlayerModal from './add-player-modal'
import BulkProvision from './bulk-provision'
import PendingPairings from './pending-pairings'
import PlayerCard from '@/components/dashboard/player-card'
import { RoleContext, isAdminRole } from '@/components/app'
import type { Player } from '@/types'

type PlayerListLayout = 'cards' | 'table'
const LAYOUT_STORAGE_KEY = 'fm_player_list_layout'

const PlayerList: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const role = useContext(RoleContext)
  const { players, loading } = useAppSelector((state) => state.players)
  const { groups } = useAppSelector((state) => state.groups)
  const { locations } = useAppSelector((state) => state.locations)

  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [showBulkProvision, setShowBulkProvision] = useState(false)
  const [layout, setLayout] = useState<PlayerListLayout>(
    () => (localStorage.getItem(LAYOUT_STORAGE_KEY) as PlayerListLayout) || 'cards',
  )

  const changeLayout = (next: PlayerListLayout) => {
    setLayout(next)
    localStorage.setItem(LAYOUT_STORAGE_KEY, next)
  }

  useEffect(() => {
    dispatch(fetchPlayers())
    dispatch(fetchGroups())
    dispatch(fetchLocations())
  }, [dispatch])

  const filteredPlayers = players.filter((player) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      player.name.toLowerCase().includes(q) ||
      player.url.toLowerCase().includes(q)
    )
  })

  const handleDelete = async (player: Player) => {
    const result = await Swal.fire({
      title: t('common.confirm'),
      text: t('players.confirmDelete'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })

    if (result.isConfirmed) {
      try {
        await dispatch(deletePlayer(player.id)).unwrap()
        Swal.fire({
          icon: 'success',
          title: t('players.deleted'),
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

  const handleEdit = (player: Player) => {
    // The list used to open this same file's basic add/provision modal
    // in "edit" mode — a materially older, more limited experience than
    // the full Settings modal (general/location/branding/image tabs,
    // live device sync) player-detail.tsx grew later. Route to that one
    // instead so both entry points land on the same UI.
    navigate(`/players/${player.id}?settings=1`)
  }

  const handleAdd = () => {
    setEditingPlayer(null)
    setShowForm(true)
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingPlayer(null)
  }

  const handleFormSaved = () => {
    setShowForm(false)
    setEditingPlayer(null)
    dispatch(fetchPlayers())
  }

  const getPlayerGroup = (player: Player) => {
    return player.group_detail || player.group
  }

  return (
    <div>
      <div className="fm-page-header">
        <div>
          <h1 className="page-title">
            <FaDesktop className="page-icon" />
            {t('players.title')}
          </h1>
        </div>
        <div className="page-actions d-flex gap-2">
          {isAdminRole(role) && (
            <button className="fm-btn-outline" onClick={() => setShowBulkProvision(true)}>
              <FaNetworkWired />
              {t('bulkProvision.title')}
            </button>
          )}
          <button className="fm-btn-primary" onClick={handleAdd}>
            <FaPlus />
            {t('players.addPlayer')}
          </button>
        </div>
      </div>

      {isAdminRole(role) && <PendingPairings />}

      <div className="fm-search-bar d-flex align-items-center gap-2">
        <div className="search-input-wrapper flex-grow-1">
          <FaSearch className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder={t('common.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="btn-group" role="group" aria-label={t('players.layoutToggle')}>
          <button
            type="button"
            className={`btn btn-sm ${layout === 'cards' ? 'fm-btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => changeLayout('cards')}
            title={t('players.layoutCards')}
          >
            <FaThLarge />
          </button>
          <button
            type="button"
            className={`btn btn-sm ${layout === 'table' ? 'fm-btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => changeLayout('table')}
            title={t('players.layoutTable')}
          >
            <FaTable />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="fm-loading">
          <div className="spinner" />
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div className="fm-empty-state">
          <div className="empty-icon">
            <FaDesktop />
          </div>
          <h3 className="empty-title">
            {players.length === 0 ? t('dashboard.noPlayers') : t('common.noResults')}
          </h3>
        </div>
      ) : layout === 'cards' ? (
        <div className="row g-3">
          {filteredPlayers.map((player) => (
            <div key={player.id} className="col-sm-6 col-lg-4 col-xl-3">
              <PlayerCard player={player} onEdit={handleEdit} onDelete={handleDelete} />
            </div>
          ))}
        </div>
      ) : (
        <div className="fm-card">
          <div className="fm-card-body p-0 table-responsive">
            <table className="fm-table">
              <thead>
                <tr>
                  <th>{t('players.name')}</th>
                  <th>{t('players.url')}</th>
                  <th>{t('players.group')}</th>
                  <th>{t('players.status')}</th>
                  <th>{t('players.lastSeen')}</th>
                  <th>{t('players.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {
                  filteredPlayers.map((player) => {
                    const group = getPlayerGroup(player)
                    return (
                      <tr key={player.id}>
                        <td>
                          <Link
                            to={`/players/${player.id}`}
                            className="fw-semibold text-decoration-none"
                          >
                            {player.name}
                          </Link>
                        </td>
                        <td>
                          <code className="text-muted" style={{ fontSize: '0.8rem' }}>
                            {player.url}
                          </code>
                        </td>
                        <td>
                          {group ? (
                            <span
                              className="fm-group-tag"
                              style={{
                                backgroundColor: group.color
                                  ? `${group.color}20`
                                  : undefined,
                                color: group.color || undefined,
                              }}
                            >
                              {group.name}
                            </span>
                          ) : (
                            <span className="text-muted">{t('players.noGroup')}</span>
                          )}
                        </td>
                        <td>
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
                              {player.is_online
                                ? t('players.online')
                                : t('players.offline')}
                            </span>
                          </span>
                        </td>
                        <td>
                          {player.last_seen
                            ? new Date(player.last_seen).toLocaleString()
                            : '--'}
                        </td>
                        <td>
                          <div className="d-flex gap-1">
                            <button
                              className="fm-btn-icon"
                              onClick={() => handleEdit(player)}
                              title={t('common.edit')}
                            >
                              <FaEdit />
                            </button>
                            <button
                              className="fm-btn-icon"
                              onClick={() => handleDelete(player)}
                              title={t('common.delete')}
                              style={{ color: '#dc3545' }}
                            >
                              <FaTrash />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <AddPlayerModal
          editingPlayer={editingPlayer}
          groups={groups}
          locations={locations}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}

      {showBulkProvision && (
        <BulkProvision onClose={() => { setShowBulkProvision(false); dispatch(fetchPlayers()) }} />
      )}
    </div>
  )
}

export default PlayerList
