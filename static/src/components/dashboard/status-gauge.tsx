import React from 'react'
import { useTranslation } from 'react-i18next'

interface StatusGaugeProps {
  online: number
  total: number
  onClick?: () => void
}

const SIZE = 84
const STROKE = 10
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Replaces the old separate "online" / "offline" number tiles with a
 * single ring gauge — the proportion reads at a glance instead of
 * requiring the two numbers to be compared mentally. */
const StatusGauge: React.FC<StatusGaugeProps> = ({ online, total, onClick }) => {
  const { t } = useTranslation()
  const offline = total - online
  const pct = total > 0 ? online / total : 0
  const onlineLength = CIRCUMFERENCE * pct

  return (
    <div
      className="fm-stat-card fm-status-gauge-card flex-grow-1"
      role="button"
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="flex-shrink-0">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#dc3545"
          strokeWidth={STROKE}
          opacity={total > 0 ? 1 : 0.25}
        />
        {total > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#28a745"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${onlineLength} ${CIRCUMFERENCE - onlineLength}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        )}
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: '1.3rem', fontWeight: 700, fill: 'var(--fm-stat-gauge-text, #2b1c48)' }}
        >
          {total}
        </text>
        <text
          x="50%"
          y="66%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: '0.5rem', fill: 'var(--fm-stat-gauge-subtext, #999)', textTransform: 'uppercase', letterSpacing: '0.03em' }}
        >
          {t('dashboard.totalPlayers')}
        </text>
      </svg>
      <div className="stat-content">
        <div className="d-flex align-items-center gap-1" style={{ fontSize: '0.85rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#28a745', flexShrink: 0 }} />
          <span className="fw-semibold">{online}</span>
          <span className="text-muted">{t('dashboard.online')}</span>
        </div>
        <div className="d-flex align-items-center gap-1" style={{ fontSize: '0.85rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc3545', flexShrink: 0 }} />
          <span className="fw-semibold">{offline}</span>
          <span className="text-muted">{t('dashboard.offline')}</span>
        </div>
      </div>
    </div>
  )
}

export default StatusGauge
