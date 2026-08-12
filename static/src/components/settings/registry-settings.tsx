import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FaServer, FaSave, FaSyncAlt, FaCheck, FaTimes, FaSpinner } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { system } from '@/services/api'
import { showToast } from '@/utils/toast'
import type { RegistryMirrorSettings, RegistryMirrorSyncStatus } from '@/types'

const POLL_INTERVAL = 2000

const RegistrySettings: React.FC = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<RegistryMirrorSettings | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [host, setHost] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<RegistryMirrorSyncStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const pollStatus = useCallback(() => {
    system.getRegistryMirrorSyncStatus().then((res) => {
      setSyncStatus(res)
      if (res.state !== 'running') {
        stopPolling()
        setSyncing(false)
        system.getRegistryMirror().then(setSettings).catch(() => {})
      }
    }).catch(() => {})
  }, [stopPolling])

  useEffect(() => {
    system.getRegistryMirror().then((res) => {
      setSettings(res)
      setEnabled(res.enabled)
      setHost(res.host)
    }).catch(() => {})
    system.getRegistryMirrorSyncStatus().then((res) => {
      setSyncStatus(res)
      if (res.state === 'running') {
        setSyncing(true)
        pollRef.current = setInterval(pollStatus, POLL_INTERVAL)
      }
    }).catch(() => {})
    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = () => {
    setSaving(true)
    system.updateRegistryMirror({ enabled, host }).then((res) => {
      setSettings(res)
      showToast('success', t('common.success'))
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setSaving(false))
  }

  const handleSync = () => {
    setSyncing(true)
    system.syncRegistryMirror().then((res) => {
      if (res.error) {
        Swal.fire({ icon: 'error', title: t('common.error'), text: res.error })
        setSyncing(false)
        return
      }
      pollRef.current = setInterval(pollStatus, POLL_INTERVAL)
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
      setSyncing(false)
    })
  }

  return (
    <div className="row g-3">
      <div className="col-12">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaServer className="me-2" />
              {t('registryMirror.title')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-2" style={{ fontSize: '0.8rem' }}>{t('registryMirror.description')}</p>

            <div className="form-check form-switch mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                id="registry-enable"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <label className="form-check-label fw-semibold" htmlFor="registry-enable">
                {t('registryMirror.enable')}
              </label>
            </div>

            <div className="mb-3">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('registryMirror.host')}</label>
              <input
                type="text"
                className="form-control form-control-sm"
                style={{ maxWidth: '260px' }}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.10:5050"
              />
              <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('registryMirror.hostDesc')}</div>
            </div>

            <div className="d-flex gap-2 mb-3">
              <button className="fm-btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                <FaSave />
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button className="fm-btn-outline btn-sm" onClick={handleSync} disabled={syncing || !settings?.enabled || !settings?.host}>
                <FaSyncAlt className={syncing ? 'fa-spin' : ''} />
                {syncing ? t('registryMirror.syncing') : t('registryMirror.syncNow')}
              </button>
            </div>

            {settings?.last_sync && (
              <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>
                {t('registryMirror.lastSync')}: {new Date(settings.last_sync).toLocaleString()}
              </p>
            )}

            {syncStatus && syncStatus.state !== 'idle' && (
              <div className="border rounded p-2" style={{ fontSize: '0.8rem' }}>
                <div className="fw-semibold mb-1">{syncStatus.message}</div>
                {syncStatus.images.map((img) => (
                  <div key={img.name} className="d-flex align-items-center gap-2 py-1">
                    {img.status === 'done' ? (
                      <FaCheck className="text-success" />
                    ) : img.status === 'failed' ? (
                      <FaTimes className="text-danger" />
                    ) : (
                      <FaSpinner className="fa-spin text-primary" />
                    )}
                    <span>{img.name}</span>
                    <span className="text-muted ms-auto">{t(`registryMirror.status_${img.status}`)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default RegistrySettings
