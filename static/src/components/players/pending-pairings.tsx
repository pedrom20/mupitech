import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaCheck, FaTimes, FaPlug } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { pairing, type PendingPairing } from '@/services/api'
import { showToast } from '@/utils/toast'
import { useAppDispatch } from '@/store/index'
import { fetchPlayers } from '@/store/playersSlice'

const POLL_INTERVAL_MS = 5000

// Admin-only panel for players/pairing_views.py's device-initiated
// pairing flow — a fresh device with no prior credential asks to join
// (see the mupitech-player CLI's `pair` command), and shows up here
// for a human to approve or reject. Renders nothing at all when
// there's nothing pending, so it never clutters the common case.
const PendingPairings: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = () => {
    pairing.list().then(setPending).catch(() => {})
  }

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleApprove = (p: PendingPairing) => {
    setBusyId(p.id)
    pairing.approve(p.id).then((res) => {
      showToast('success', t('pairing.approvedToast', { name: res.player_name }))
      dispatch(fetchPlayers())
      load()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setBusyId(null))
  }

  const handleReject = async (p: PendingPairing) => {
    const confirmed = await Swal.fire({
      icon: 'warning',
      title: t('pairing.rejectConfirmTitle'),
      showCancelButton: true,
      confirmButtonText: t('pairing.rejectButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!confirmed.isConfirmed) return

    setBusyId(p.id)
    pairing.reject(p.id).then(() => {
      load()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setBusyId(null))
  }

  if (pending.length === 0) return null

  return (
    <div className="fm-card fm-card-accent mb-3">
      <div className="fm-card-header py-2">
        <h5 className="card-title mb-0">
          <FaPlug className="me-2" />
          {t('pairing.title')}
          <span className="badge bg-info-subtle text-info-emphasis ms-2">{pending.length}</span>
        </h5>
      </div>
      <div className="fm-card-body py-2">
        <div className="d-flex flex-column gap-2">
          {pending.map((p) => (
            <div
              key={p.id}
              className="d-flex flex-wrap align-items-center justify-content-between gap-2 p-2"
              style={{ border: '1px solid var(--fm-border-color, #e2e5ea)', borderRadius: '8px' }}
            >
              <div className="d-flex align-items-center gap-3">
                <span
                  className="fw-bold"
                  style={{ fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '0.1em' }}
                >
                  {p.pairing_code}
                </span>
                <div>
                  <div className="fw-semibold" style={{ fontSize: '0.9rem' }}>
                    {p.device_name || t('pairing.unnamedDevice')}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {p.url}{p.mac_address ? ` — ${p.mac_address}` : ''}
                  </div>
                </div>
                {p.is_expired && (
                  <span className="badge bg-secondary">{t('pairing.expired')}</span>
                )}
              </div>
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="fm-btn-primary btn-sm"
                  onClick={() => handleApprove(p)}
                  disabled={busyId === p.id || p.is_expired}
                >
                  <FaCheck />
                  {t('pairing.approveButton')}
                </button>
                <button
                  type="button"
                  className="fm-btn-danger btn-sm"
                  onClick={() => handleReject(p)}
                  disabled={busyId === p.id}
                >
                  <FaTimes />
                  {t('pairing.rejectButton')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PendingPairings
