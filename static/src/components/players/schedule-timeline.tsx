import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FaCalendarAlt } from 'react-icons/fa'
import type { PlayerAsset } from '@/types'

// ── Types ──

interface DisplaySchedule {
  enabled: boolean
  days: Record<string, { on: string; off: string } | null>
}

interface ScheduleTimelineProps {
  assets: PlayerAsset[]
  displaySchedule?: DisplaySchedule
}

type ViewMode = 'day' | 'week'
type AssetKind = 'default' | 'time' | 'event'

// A window this short (minutes) reads as a one-off moment rather than
// a scheduled block of programming — e.g. a "minute of silence" — and
// gets the Event treatment instead of a Time-slot color. There's no
// explicit "is this an event" field on an asset (that concept existed
// on the old slot model, removed when scheduling moved to this
// simpler per-asset day/time recurrence — see git history of this
// file), so this is a deliberate heuristic, not derived data.
const EVENT_MAX_WINDOW_MIN = 15

// ── Color palette ──

const DEFAULT_COLOR = { bg: 'rgba(255,193,7,0.25)', border: '#ffc107' }
const EVENT_COLOR = { bg: 'rgba(220,53,69,0.30)', border: '#dc3545' }

const TIME_SLOT_PALETTE = [
  { bg: 'rgba(136,25,199,0.45)', border: '#8819c7' },   // Purple
  { bg: 'rgba(25,135,199,0.40)', border: '#1987c7' },    // Blue
  { bg: 'rgba(0,166,125,0.35)', border: '#00a67d' },    // Teal
  { bg: 'rgba(199,120,25,0.40)', border: '#c77819' },    // Orange
  { bg: 'rgba(199,25,120,0.35)', border: '#c71978' },    // Pink
  { bg: 'rgba(80,160,40,0.35)', border: '#50a028' },    // Green
]

// ── Helpers ──

const dayOfWeekISO = (date: Date): number => {
  const d = date.getDay()
  return d === 0 ? 7 : d
}

const parseTime = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

const addDays = (d: Date, n: number) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const getMonday = (date: Date) => {
  const d = new Date(date)
  const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

const toISODate = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'default' (always eligible, no time window) | 'time' (has a window
 * wider than EVENT_MAX_WINDOW_MIN) | 'event' (has a short window). */
const classifyAsset = (asset: PlayerAsset): AssetKind => {
  if (!asset.play_time_from || !asset.play_time_to) return 'default'
  const from = parseTime(asset.play_time_from)
  const to = parseTime(asset.play_time_to)
  const windowMin = to > from ? to - from : 1440 - from + to
  return windowMin <= EVENT_MAX_WINDOW_MIN ? 'event' : 'time'
}

/** Whether `asset` is eligible to play at all on `date` — its
 * start/end date range covers it and, if it has specific play_days,
 * date's weekday is one of them (empty/missing play_days means every
 * day, per PlayerAsset's own doc comment in types.ts). */
const assetAppliesToDate = (asset: PlayerAsset, date: Date): boolean => {
  if (asset.start_date && date < new Date(new Date(asset.start_date).setHours(0, 0, 0, 0))) return false
  if (asset.end_date && date > new Date(new Date(asset.end_date).setHours(23, 59, 59, 999))) return false
  if (asset.play_days && asset.play_days.length > 0 && !asset.play_days.includes(dayOfWeekISO(date))) return false
  return true
}

const assetsForDay = (assets: PlayerAsset[], date: Date): PlayerAsset[] =>
  assets.filter(a => a.is_enabled && assetAppliesToDate(a, date))

/** Build a stable color map: asset_id → palette index, for time-kind assets only. */
const buildAssetColorMap = (assets: PlayerAsset[]): Map<string, number> => {
  const map = new Map<string, number>()
  let idx = 0
  for (const a of assets) {
    if (classifyAsset(a) === 'time' && !map.has(a.asset_id)) {
      map.set(a.asset_id, idx % TIME_SLOT_PALETTE.length)
      idx++
    }
  }
  return map
}

const getTimeAssetColor = (assetId: string, colorMap: Map<string, number>) => {
  const idx = colorMap.get(assetId)
  return idx !== undefined ? TIME_SLOT_PALETTE[idx] : TIME_SLOT_PALETTE[0]
}

// ── Display-off overlay ranges ──

interface OffRange { leftPct: number; widthPct: number }

const getDisplayOffRanges = (displaySchedule: DisplaySchedule | undefined, dow: number): OffRange[] => {
  if (!displaySchedule?.enabled) return []
  const dayKey = String(dow)
  const dayCfg = displaySchedule.days[dayKey]

  if (dayCfg === null) {
    return [{ leftPct: 0, widthPct: 100 }]
  }
  if (dayCfg === undefined) return []

  const onMin = parseTime(dayCfg.on)
  const offMin = parseTime(dayCfg.off)

  const ranges: OffRange[] = []
  if (onMin > 0) {
    ranges.push({ leftPct: 0, widthPct: (onMin / 1440) * 100 })
  }
  if (offMin < 1440) {
    ranges.push({ leftPct: (offMin / 1440) * 100, widthPct: ((1440 - offMin) / 1440) * 100 })
  }
  return ranges
}

// ── Day View ──

const DayView: React.FC<{
  assets: PlayerAsset[]
  selectedDate: Date
  colorMap: Map<string, number>
  displaySchedule?: DisplaySchedule
  t: (k: string) => string
}> = ({ assets, selectedDate, colorMap, displaySchedule, t }) => {
  const now = new Date()
  const isToday = isSameDay(selectedDate, now)
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const nowPct = (currentMinutes / 1440) * 100
  const dow = dayOfWeekISO(selectedDate)
  const active = assetsForDay(assets, selectedDate)
  const defaultAssets = active.filter(a => classifyAsset(a) === 'default')
  const timeAssets = active.filter(a => classifyAsset(a) === 'time')
  const eventAssets = active.filter(a => classifyAsset(a) === 'event')
  const offRanges = getDisplayOffRanges(displaySchedule, dow)

  const [tooltip, setTooltip] = useState<{ asset: PlayerAsset; kind: AssetKind; x: number; y: number } | null>(null)

  return (
    <div className="fm-timeline-day">
      <div className="fm-timeline-hours">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>

      <div className="fm-timeline-track">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => (
          <div key={h} className="fm-timeline-gridline" style={{ left: `${(h / 24) * 100}%` }} />
        ))}

        {defaultAssets.length > 0 && (
          <div
            className="fm-timeline-bar fm-timeline-bar-default"
            style={{ left: 0, width: '100%', background: DEFAULT_COLOR.bg }}
            onMouseEnter={(e) => setTooltip({ asset: defaultAssets[0], kind: 'default', x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setTooltip(null)}
          />
        )}

        {timeAssets.map(asset => {
          const from = parseTime(asset.play_time_from!)
          const to = parseTime(asset.play_time_to!)
          const leftPct = (from / 1440) * 100
          const widthPct = ((to > from ? to - from : 1440 - from + to) / 1440) * 100
          const color = getTimeAssetColor(asset.asset_id, colorMap)

          return (
            <div
              key={asset.asset_id}
              className="fm-timeline-bar fm-timeline-bar-time"
              style={{
                left: `${leftPct}%`,
                width: `${Math.max(widthPct, 0.5)}%`,
                background: color.bg,
                borderLeft: `3px solid ${color.border}`,
              }}
              onMouseEnter={(e) => setTooltip({ asset, kind: 'time', x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => tooltip && setTooltip({ asset, kind: 'time', x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            >
              <span className="fm-timeline-bar-label">{asset.name}</span>
            </div>
          )
        })}

        {eventAssets.map(asset => {
          const from = parseTime(asset.play_time_from!)
          const to = parseTime(asset.play_time_to!)
          const windowMin = to > from ? to - from : 1440 - from + to
          const leftPct = (from / 1440) * 100
          const widthPct = (windowMin / 1440) * 100

          return (
            <div
              key={asset.asset_id}
              className="fm-timeline-bar fm-timeline-bar-event"
              style={{
                left: `${leftPct}%`,
                width: `${Math.max(widthPct, 0.3)}%`,
                minWidth: '4px',
                background: EVENT_COLOR.bg,
                borderLeft: `3px solid ${EVENT_COLOR.border}`,
              }}
              onMouseEnter={(e) => setTooltip({ asset, kind: 'event', x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => tooltip && setTooltip({ asset, kind: 'event', x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            >
              <span className="fm-timeline-bar-label">{asset.name}</span>
            </div>
          )
        })}

        {offRanges.map((r, i) => (
          <div
            key={`off-${i}`}
            className="fm-timeline-display-off"
            style={{ left: `${r.leftPct}%`, width: `${r.widthPct}%` }}
            title={t('schedule.timeline.displayOff')}
          />
        ))}

        {isToday && (
          <div className="fm-timeline-now" style={{ left: `${nowPct}%` }}>
            <div className="fm-timeline-now-dot" />
            <div className="fm-timeline-now-line" />
          </div>
        )}
      </div>

      {tooltip && (
        <div
          className="fm-timeline-tooltip"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <strong>{tooltip.asset.name}</strong>
          <div>
            {tooltip.kind === 'default'
              ? t('schedule.timeline.defaultSlot')
              : `${tooltip.asset.play_time_from?.substring(0, 5)} – ${tooltip.asset.play_time_to?.substring(0, 5)}`}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Week View ──

const WeekView: React.FC<{
  assets: PlayerAsset[]
  weekStart: Date
  colorMap: Map<string, number>
  displaySchedule?: DisplaySchedule
  t: (k: string) => string
}> = ({ assets, weekStart, colorMap, displaySchedule, t }) => {
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const nowPct = (currentMinutes / 1440) * 100

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    const dow = dayOfWeekISO(date)
    return { date, dow, isToday: isSameDay(date, now) }
  })

  return (
    <div className="fm-timeline-week">
      <div className="fm-timeline-week-hours">
        <div className="fm-timeline-week-label" />
        {[0, 6, 12, 18, 24].map(h => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>

      {days.map(({ date, dow, isToday }) => {
        const dayAssets = assetsForDay(assets, date)
        const defaultAssets = dayAssets.filter(a => classifyAsset(a) === 'default')
        const timeAssets = dayAssets.filter(a => classifyAsset(a) === 'time')
        const eventAssets = dayAssets.filter(a => classifyAsset(a) === 'event')
        const offRanges = getDisplayOffRanges(displaySchedule, dow)

        const dayLabel = `${t(`schedule.days.${dow}`)} ${date.getDate()}`

        return (
          <div key={dow} className={`fm-timeline-week-row ${isToday ? 'fm-timeline-week-today' : ''}`}>
            <div className="fm-timeline-week-label">{dayLabel}</div>
            <div className="fm-timeline-week-track-wrap">
              <div className="fm-timeline-week-track">
                {[0, 6, 12, 18, 24].map(h => (
                  <div key={h} className="fm-timeline-gridline" style={{ left: `${(h / 24) * 100}%` }} />
                ))}

                {defaultAssets.length > 0 && (
                  <div
                    className="fm-timeline-bar fm-timeline-bar-default"
                    style={{ left: 0, width: '100%', background: DEFAULT_COLOR.bg }}
                  />
                )}

                {timeAssets.map(asset => {
                  const from = parseTime(asset.play_time_from!)
                  const to = parseTime(asset.play_time_to!)
                  const leftPct = (from / 1440) * 100
                  const widthPct = ((to > from ? to - from : 1440 - from + to) / 1440) * 100
                  const color = getTimeAssetColor(asset.asset_id, colorMap)
                  return (
                    <div
                      key={asset.asset_id}
                      className="fm-timeline-bar fm-timeline-bar-time"
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(widthPct, 0.5)}%`,
                        background: color.bg,
                        borderLeft: `2px solid ${color.border}`,
                      }}
                      title={`${asset.name} (${asset.play_time_from?.substring(0, 5)}–${asset.play_time_to?.substring(0, 5)})`}
                    />
                  )
                })}

                {eventAssets.map(asset => {
                  const from = parseTime(asset.play_time_from!)
                  const to = parseTime(asset.play_time_to!)
                  const windowMin = to > from ? to - from : 1440 - from + to
                  const leftPct = (from / 1440) * 100
                  const widthPct = (windowMin / 1440) * 100
                  return (
                    <div
                      key={asset.asset_id}
                      className="fm-timeline-bar fm-timeline-bar-event"
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(widthPct, 0.3)}%`,
                        minWidth: '4px',
                        background: EVENT_COLOR.bg,
                        borderLeft: `2px solid ${EVENT_COLOR.border}`,
                      }}
                      title={`${asset.name} (${asset.play_time_from?.substring(0, 5)})`}
                    />
                  )
                })}

                {offRanges.map((r, i) => (
                  <div
                    key={`off-${i}`}
                    className="fm-timeline-display-off"
                    style={{ left: `${r.leftPct}%`, width: `${r.widthPct}%` }}
                  />
                ))}

                {isToday && (
                  <div className="fm-timeline-now fm-timeline-now-sm" style={{ left: `${nowPct}%` }}>
                    <div className="fm-timeline-now-line" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main Component ──

export const ScheduleTimeline: React.FC<ScheduleTimelineProps> = ({ assets, displaySchedule }) => {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewMode>('day')
  const now = new Date()

  const [selectedDate, setSelectedDate] = useState(new Date())
  const [weekStart, setWeekStart] = useState(getMonday(new Date()))

  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  const colorMap = useMemo(() => buildAssetColorMap(assets), [assets])

  const legendTimeAssets = useMemo(() => {
    const seen = new Map<number, string>()
    for (const a of assets) {
      if (classifyAsset(a) === 'time') {
        const idx = colorMap.get(a.asset_id)
        if (idx !== undefined && !seen.has(idx)) {
          seen.set(idx, a.name)
        }
      }
    }
    return Array.from(seen.entries()).map(([idx, name]) => ({
      color: TIME_SLOT_PALETTE[idx],
      name,
    }))
  }, [assets, colorMap])

  const hasEvents = assets.some(a => classifyAsset(a) === 'event')
  const hasDefault = assets.some(a => classifyAsset(a) === 'default')
  const showDisplayOff = displaySchedule?.enabled

  if (assets.length === 0) {
    return null
  }

  const views: { key: ViewMode; label: string }[] = [
    { key: 'day', label: t('schedule.timeline.day') },
    { key: 'week', label: t('schedule.timeline.week') },
  ]

  const isToday = isSameDay(selectedDate, now)
  const isCurrentWeek = isSameDay(weekStart, getMonday(now))

  const weekEnd = addDays(weekStart, 6)
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const weekLabel = `${pad2(weekStart.getDate())}.${pad2(weekStart.getMonth() + 1)} – ${pad2(weekEnd.getDate())}.${pad2(weekEnd.getMonth() + 1)}.${weekEnd.getFullYear()}`

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = new Date(e.target.value + 'T00:00:00')
    if (!isNaN(d.getTime())) {
      setSelectedDate(d)
      setWeekStart(getMonday(d))
    }
  }

  const goToday = () => {
    setSelectedDate(new Date())
    setWeekStart(getMonday(new Date()))
  }

  return (
    <div className="fm-card fm-card-accent-purple mt-3">
      <div className="fm-card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div className="d-flex align-items-center gap-2">
          <h5 className="card-title mb-0">{t('schedule.timeline.title')}</h5>

          <div className="fm-timeline-nav">
            <FaCalendarAlt className="fm-timeline-cal-icon" />
            <input
              type="date"
              className="fm-timeline-date-input"
              value={toISODate(selectedDate)}
              onChange={handleDateChange}
            />
            {view === 'week' && (
              <span className="fm-timeline-week-range">{weekLabel}</span>
            )}
            {((view === 'day' && !isToday) || (view === 'week' && !isCurrentWeek)) && (
              <button type="button" className="fm-timeline-today-btn" onClick={goToday}>
                {t('schedule.timeline.today')}
              </button>
            )}
          </div>
        </div>

        <div className="d-flex align-items-center gap-2">
          <div className="fm-timeline-legend d-none d-md-flex">
            {hasDefault && (
              <span className="fm-timeline-legend-item">
                <span className="fm-timeline-legend-swatch" style={{ background: DEFAULT_COLOR.border }} />
                {t('schedule.timeline.defaultSlot')}
              </span>
            )}
            {legendTimeAssets.map((ls, i) => (
              <span key={i} className="fm-timeline-legend-item">
                <span className="fm-timeline-legend-swatch" style={{ background: ls.color.border }} />
                {ls.name}
              </span>
            ))}
            {hasEvents && (
              <span className="fm-timeline-legend-item">
                <span className="fm-timeline-legend-swatch" style={{ background: EVENT_COLOR.border }} />
                {t('schedule.timeline.eventSlot')}
              </span>
            )}
            {showDisplayOff && (
              <span className="fm-timeline-legend-item">
                <span className="fm-timeline-legend-swatch fm-timeline-legend-swatch-off" />
                {t('schedule.timeline.displayOff')}
              </span>
            )}
          </div>
          <div className="fm-timeline-pills">
            {views.map(v => (
              <button
                key={v.key}
                type="button"
                className={`fm-timeline-pill ${view === v.key ? 'fm-timeline-pill-active' : ''}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="fm-card-body">
        {view === 'day' && <DayView assets={assets} selectedDate={selectedDate} colorMap={colorMap} displaySchedule={displaySchedule} t={t} />}
        {view === 'week' && <WeekView assets={assets} weekStart={weekStart} colorMap={colorMap} displaySchedule={displaySchedule} t={t} />}
      </div>
    </div>
  )
}
