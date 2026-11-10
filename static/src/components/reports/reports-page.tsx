import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaChartLine, FaPhotoVideo, FaUsers, FaToggleOn, FaToggleOff } from 'react-icons/fa'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import Swal from 'sweetalert2'
import { reports as reportsApi, players as playersApi, ApiError } from '@/services/api'
import type { SlaReport, ContentReport, UsersReport } from '@/types'

// Single-hue chart ink (dataviz skill's categorical slot 1 / sequential
// anchor, #2a78d6) — every chart here is one series, so no legend/CVD
// adjacency concerns, just a consistent accent distinct from the
// Bootstrap status colors used for the uptime badges below.
const CHART_INK = '#2a78d6'
const GRID_INK = '#e1e0d9'
const AXIS_INK = '#898781'

type Tab = 'sla' | 'content' | 'users'
type Preset = 7 | 30 | 90 | 'custom'

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

const uptimeClass = (pct: number | null): string => {
  if (pct === null) return 'text-muted'
  if (pct >= 98) return 'text-success'
  if (pct >= 90) return 'text-warning'
  return 'text-danger'
}

const PeriodSelector: React.FC<{
  preset: Preset
  start: string
  end: string
  onPreset: (p: Preset) => void
  onCustom: (start: string, end: string) => void
}> = ({ preset, start, end, onPreset, onCustom }) => {
  const { t } = useTranslation()
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
      {([7, 30, 90] as const).map((days) => (
        <button
          key={days}
          type="button"
          className={`btn btn-sm ${preset === days ? 'fm-btn-primary' : 'fm-btn-outline'}`}
          onClick={() => onPreset(days)}
        >
          {t('reports.lastNDays', { count: days })}
        </button>
      ))}
      <div className="d-flex align-items-center gap-1 ms-2">
        <input
          type="date"
          className="form-control form-control-sm"
          value={start}
          max={end}
          onChange={(e) => onCustom(e.target.value, end)}
        />
        <span className="text-muted small">{t('reports.rangeTo')}</span>
        <input
          type="date"
          className="form-control form-control-sm"
          value={end}
          min={start}
          max={isoDate(new Date())}
          onChange={(e) => onCustom(start, e.target.value)}
        />
      </div>
    </div>
  )
}

const SlaSection: React.FC<{ start: string; end: string }> = ({ start, end }) => {
  const { t } = useTranslation()
  const [data, setData] = useState<SlaReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    reportsApi.sla({ start, end }).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }

  useEffect(load, [start, end])

  const handleToggleExclude = async (playerId: string, currentlyExcluded: boolean) => {
    setTogglingId(playerId)
    try {
      await playersApi.partialUpdate(playerId, { exclude_from_sla: !currentlyExcluded })
      // Refetch rather than patch local state — flipping this one device
      // also changes fleet_uptime_pct, which only the backend recomputes.
      load()
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: error instanceof ApiError ? error.message : String(error) })
    } finally {
      setTogglingId(null)
    }
  }

  if (loading) return <p className="text-muted">{t('common.loading')}</p>
  if (!data) return <p className="text-muted">{t('common.error')}</p>

  const sorted = [...data.devices].sort((a, b) => (a.uptime_pct ?? 101) - (b.uptime_pct ?? 101))

  return (
    <div>
      <div className="fm-stat-card mb-3" style={{ maxWidth: '280px' }}>
        <div className="stat-content">
          <div className={`stat-value ${uptimeClass(data.fleet_uptime_pct)}`} style={{ fontSize: '2.5rem', fontWeight: 600 }}>
            {data.fleet_uptime_pct === null ? '—' : `${data.fleet_uptime_pct}%`}
          </div>
          <div className="stat-label">{t('reports.fleetUptime')}</div>
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-sm fm-table mb-0">
          <thead>
            <tr>
              <th>{t('reports.device')}</th>
              <th>{t('groups.title')}</th>
              <th>{t('locations.title')}</th>
              <th>{t('reports.uptime')}</th>
              <th>{t('reports.snapshots')}</th>
              <th>{t('reports.excludeFromSla')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.player_id} className={d.excluded ? 'opacity-50' : ''}>
                <td className="fw-semibold">
                  {d.player_name}
                  {d.excluded && <span className="badge bg-secondary ms-2">{t('reports.excluded')}</span>}
                </td>
                <td>{d.group_name || '—'}</td>
                <td>{d.location_name || '—'}</td>
                <td className={`fw-semibold ${uptimeClass(d.uptime_pct)}`}>
                  {d.uptime_pct === null ? t('reports.noData') : `${d.uptime_pct}%`}
                </td>
                <td className="text-muted">{d.online_snapshots}/{d.total_snapshots}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    disabled={togglingId === d.player_id}
                    onClick={() => handleToggleExclude(d.player_id, d.excluded)}
                    title={t(d.excluded ? 'reports.includeInSla' : 'reports.excludeFromSla')}
                  >
                    {d.excluded ? <FaToggleOff /> : <FaToggleOn />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ContentSection: React.FC<{ start: string; end: string }> = ({ start, end }) => {
  const { t } = useTranslation()
  const [data, setData] = useState<ContentReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    reportsApi.content({ start, end }).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [start, end])

  if (loading) return <p className="text-muted">{t('common.loading')}</p>
  if (!data) return <p className="text-muted">{t('common.error')}</p>

  const chartData = data.top_content.map((c) => ({ name: c.name, minutes: Math.round(c.seconds / 60) }))
  // Taller per-row bars for long filenames (horizontal layout) rather than
  // a fixed chart height, so labels never collide — see marks-and-anatomy.md.
  const chartHeight = Math.max(120, chartData.length * 32)

  return (
    <div>
      <div className="d-flex flex-wrap gap-3 mb-3">
        <div className="fm-stat-card" style={{ minWidth: '160px' }}>
          <div className="stat-content">
            <div className="stat-value">{data.uploads}</div>
            <div className="stat-label">{t('reports.uploads')}</div>
          </div>
        </div>
        <div className="fm-stat-card" style={{ minWidth: '160px' }}>
          <div className="stat-content">
            <div className="stat-value">{data.playlist_deploys}</div>
            <div className="stat-label">{t('reports.playlistDeploys')}</div>
          </div>
        </div>
      </div>

      <h6 className="mb-2">{t('reports.topContent')}</h6>
      {chartData.length === 0 ? (
        <p className="text-muted">{t('common.noResults')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid horizontal={false} stroke={GRID_INK} />
            <XAxis type="number" tick={{ fill: AXIS_INK, fontSize: 12 }} label={{ value: t('reports.minutesPlayed'), position: 'insideBottom', offset: -5, fill: AXIS_INK, fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={160} tick={{ fill: AXIS_INK, fontSize: 12 }} />
            <Tooltip formatter={(value) => [`${value} ${t('reports.min')}`, t('reports.minutesPlayed')]} />
            <Bar dataKey="minutes" fill={CHART_INK} radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

const UsersSection: React.FC<{ start: string; end: string }> = ({ start, end }) => {
  const { t } = useTranslation()
  const [data, setData] = useState<UsersReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    reportsApi.users({ start, end }).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [start, end])

  if (loading) return <p className="text-muted">{t('common.loading')}</p>
  if (!data) return <p className="text-muted">{t('common.error')}</p>

  return (
    <div>
      <h6 className="mb-2">{t('reports.loginsByDay')}</h6>
      {data.logins_by_day.length === 0 ? (
        <p className="text-muted">{t('common.noResults')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data.logins_by_day} margin={{ left: 0, right: 16 }}>
            <CartesianGrid vertical={false} stroke={GRID_INK} />
            <XAxis dataKey="date" tick={{ fill: AXIS_INK, fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fill: AXIS_INK, fontSize: 12 }} />
            <Tooltip />
            <Line type="monotone" dataKey="count" name={t('reports.logins')} stroke={CHART_INK} strokeWidth={2} dot={{ r: 4, fill: CHART_INK }} />
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="row g-3 mt-1">
        <div className="col-md-6">
          <h6 className="mb-2">{t('reports.topUsers')}</h6>
          <table className="table table-sm fm-table mb-0">
            <thead><tr><th>{t('users.username')}</th><th>{t('reports.actions')}</th></tr></thead>
            <tbody>
              {data.top_users.map((u) => (
                <tr key={u.user_id}><td>{u.username}</td><td>{u.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="col-md-6">
          <h6 className="mb-2">{t('reports.byAction')}</h6>
          <table className="table table-sm fm-table mb-0">
            <thead><tr><th>{t('audit.action')}</th><th>{t('reports.actions')}</th></tr></thead>
            <tbody>
              {data.by_action.map((a) => (
                <tr key={a.action}><td>{a.action}</td><td>{a.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const ReportsPage: React.FC = () => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('sla')
  const [preset, setPreset] = useState<Preset>(30)
  const [start, setStart] = useState(() => isoDate(new Date(Date.now() - 29 * 86400000)))
  const [end, setEnd] = useState(() => isoDate(new Date()))

  const handlePreset = (days: Preset) => {
    setPreset(days)
    if (days !== 'custom') {
      setEnd(isoDate(new Date()))
      setStart(isoDate(new Date(Date.now() - (days - 1) * 86400000)))
    }
  }

  const handleCustom = (newStart: string, newEnd: string) => {
    setPreset('custom')
    setStart(newStart)
    setEnd(newEnd)
  }

  return (
    <div className="fm-card fm-card-accent">
      <div className="fm-card-header py-2 d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div className="d-flex border-bottom-0">
          {([
            { id: 'sla' as const, icon: <FaChartLine className="me-1" />, label: t('reports.slaTab') },
            { id: 'content' as const, icon: <FaPhotoVideo className="me-1" />, label: t('reports.contentTab') },
            { id: 'users' as const, icon: <FaUsers className="me-1" />, label: t('reports.usersTab') },
          ]).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn btn-link text-decoration-none ${tab === item.id ? 'fw-bold border-bottom border-2 border-primary text-primary' : 'text-muted'}`}
              onClick={() => setTab(item.id)}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fm-card-body py-3">
        <PeriodSelector preset={preset} start={start} end={end} onPreset={handlePreset} onCustom={handleCustom} />
        {tab === 'sla' && <SlaSection start={start} end={end} />}
        {tab === 'content' && <ContentSection start={start} end={end} />}
        {tab === 'users' && <UsersSection start={start} end={end} />}
      </div>
    </div>
  )
}

export default ReportsPage
