import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaShieldAlt, FaCheckCircle, FaMobileAlt } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { mfa, duo, ApiError } from '@/services/api'
import { showToast } from '@/utils/toast'

type Phase = 'loading' | 'disabled' | 'enrolling' | 'enabled'
type DuoPhase = 'loading' | 'unavailable' | 'disabled' | 'enrolling' | 'enabled'

const DUO_POLL_INTERVAL_MS = 2000

const SecuritySettings: React.FC = () => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('loading')
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)
  const [otpauthUri, setOtpauthUri] = useState('')
  const [qrPng, setQrPng] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const [duoPhase, setDuoPhase] = useState<DuoPhase>('loading')
  const [duoBarcode, setDuoBarcode] = useState('')
  const [duoPassword, setDuoPassword] = useState('')
  const [duoBusy, setDuoBusy] = useState(false)
  const duoPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadStatus = () => {
    mfa.status().then((res) => {
      setConfirmedAt(res.confirmed_at)
      setPhase(res.enabled ? 'enabled' : 'disabled')
    }).catch(() => setPhase('disabled'))
  }

  const stopDuoPolling = () => {
    if (duoPollRef.current) { clearInterval(duoPollRef.current); duoPollRef.current = null }
  }

  const loadDuoStatus = () => {
    duo.status().then((res) => {
      setDuoPhase(!res.configured ? 'unavailable' : res.enabled ? 'enabled' : 'disabled')
    }).catch(() => setDuoPhase('unavailable'))
  }

  useEffect(() => {
    loadStatus()
    loadDuoStatus()
    return () => stopDuoPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEnroll = () => {
    setBusy(true)
    mfa.enroll().then((res) => {
      setOtpauthUri(res.otpauth_uri)
      setQrPng(res.qr_png_base64)
      setCode('')
      setPhase('enrolling')
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.enrollError'),
      })
    }).finally(() => setBusy(false))
  }

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    mfa.confirm(code).then(() => {
      showToast('success', t('security.enabledSuccess'))
      loadStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.confirmError'),
      })
      setCode('')
    }).finally(() => setBusy(false))
  }

  const handleCancelEnroll = () => {
    setOtpauthUri('')
    setQrPng('')
    setCode('')
    setPhase('disabled')
  }

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault()
    const confirmed = await Swal.fire({
      icon: 'warning',
      title: t('security.disableConfirmTitle'),
      text: t('security.disableConfirmText'),
      showCancelButton: true,
      confirmButtonText: t('security.disableButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!confirmed.isConfirmed) return

    setBusy(true)
    mfa.disable(password).then(() => {
      showToast('success', t('security.disabledSuccess'))
      setPassword('')
      loadStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.disableError'),
      })
    }).finally(() => setBusy(false))
  }

  const pollDuoConfirm = () => {
    duo.confirm().then((res) => {
      if (res.status === 'success') {
        stopDuoPolling()
        showToast('success', t('security.enabledSuccess'))
        loadDuoStatus()
      }
    }).catch(() => {
      // Transient errors (network blip) just get retried on the next tick.
    })
  }

  const handleDuoEnroll = () => {
    setDuoBusy(true)
    duo.enroll().then((res) => {
      setDuoBarcode(res.activation_barcode)
      setDuoPhase('enrolling')
      duoPollRef.current = setInterval(pollDuoConfirm, DUO_POLL_INTERVAL_MS)
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.duoEnrollError'),
      })
    }).finally(() => setDuoBusy(false))
  }

  const handleDuoCancelEnroll = () => {
    stopDuoPolling()
    setDuoBarcode('')
    setDuoPhase('disabled')
  }

  const handleDuoDisable = async (e: React.FormEvent) => {
    e.preventDefault()
    const confirmed = await Swal.fire({
      icon: 'warning',
      title: t('security.disableConfirmTitle'),
      text: t('security.disableConfirmText'),
      showCancelButton: true,
      confirmButtonText: t('security.disableButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!confirmed.isConfirmed) return

    setDuoBusy(true)
    duo.disable(duoPassword).then(() => {
      showToast('success', t('security.disabledSuccess'))
      setDuoPassword('')
      loadDuoStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.disableError'),
      })
    }).finally(() => setDuoBusy(false))
  }

  return (
    <div className="row g-3">
      <div className="col-lg-6">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaShieldAlt className="me-2" />
              {t('security.mfaTitle')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('security.mfaDescription')}</p>

            {phase === 'loading' && (
              <p className="form-text mb-0">{t('common.loading')}</p>
            )}

            {phase === 'disabled' && (
              <>
                <span className="badge bg-secondary mb-3">{t('security.statusDisabled')}</span>
                <div>
                  <button
                    type="button"
                    className="fm-btn-primary"
                    onClick={handleEnroll}
                    disabled={busy}
                  >
                    <FaShieldAlt className="me-1" />
                    {t('security.enableButton')}
                  </button>
                </div>
              </>
            )}

            {phase === 'enabled' && (
              <>
                <span className="badge bg-success mb-3">
                  <FaCheckCircle className="me-1" />
                  {t('security.statusEnabled')}
                </span>
                {confirmedAt && (
                  <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>
                    {t('security.confirmedOn', { date: new Date(confirmedAt).toLocaleString() })}
                  </p>
                )}
                <form onSubmit={handleDisable} className="d-flex flex-wrap gap-2 align-items-end">
                  <div>
                    <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                      {t('security.currentPasswordLabel')}
                    </label>
                    <input
                      type="password"
                      className="form-control form-control-sm"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="fm-btn-outline btn-sm" disabled={busy || !password}>
                    {t('security.disableButton')}
                  </button>
                </form>
              </>
            )}

            {phase === 'enrolling' && (
              <div>
                <p className="form-text mb-2" style={{ fontSize: '0.8rem' }}>{t('security.scanQrHint')}</p>
                {qrPng && (
                  <img
                    src={`data:image/png;base64,${qrPng}`}
                    alt="QR code"
                    style={{ width: 200, height: 200, imageRendering: 'pixelated' }}
                    className="mb-3 border rounded p-2 bg-white"
                  />
                )}
                <p className="form-text mb-1" style={{ fontSize: '0.8rem' }}>{t('security.manualEntryLabel')}</p>
                <code className="d-block mb-3" style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>
                  {otpauthUri.match(/secret=([^&]+)/)?.[1] || otpauthUri}
                </code>

                <form onSubmit={handleConfirm}>
                  <div className="mb-3" style={{ maxWidth: 200 }}>
                    <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                      {t('security.enterCodeLabel')}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      className="form-control text-center"
                      style={{ letterSpacing: '0.3em' }}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="d-flex gap-2">
                    <button type="submit" className="fm-btn-primary btn-sm" disabled={busy || code.length !== 6}>
                      {t('security.confirmButton')}
                    </button>
                    <button type="button" className="fm-btn-outline btn-sm" onClick={handleCancelEnroll} disabled={busy}>
                      {t('security.cancelButton')}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="col-lg-6">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaMobileAlt className="me-2" />
              {t('security.duoTitle')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('security.duoDescription')}</p>

            {duoPhase === 'loading' && (
              <p className="form-text mb-0">{t('common.loading')}</p>
            )}

            {duoPhase === 'unavailable' && (
              <span className="badge bg-light text-muted border">{t('security.duoNotConfigured')}</span>
            )}

            {duoPhase === 'disabled' && (
              <>
                <span className="badge bg-secondary mb-3">{t('security.statusDisabled')}</span>
                <div>
                  <button
                    type="button"
                    className="fm-btn-primary"
                    onClick={handleDuoEnroll}
                    disabled={duoBusy}
                  >
                    <FaMobileAlt className="me-1" />
                    {t('security.duoEnableButton')}
                  </button>
                </div>
              </>
            )}

            {duoPhase === 'enabled' && (
              <>
                <span className="badge bg-success mb-3">
                  <FaCheckCircle className="me-1" />
                  {t('security.statusEnabled')}
                </span>
                <form onSubmit={handleDuoDisable} className="d-flex flex-wrap gap-2 align-items-end">
                  <div>
                    <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                      {t('security.currentPasswordLabel')}
                    </label>
                    <input
                      type="password"
                      className="form-control form-control-sm"
                      value={duoPassword}
                      onChange={(e) => setDuoPassword(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="fm-btn-outline btn-sm" disabled={duoBusy || !duoPassword}>
                    {t('security.disableButton')}
                  </button>
                </form>
              </>
            )}

            {duoPhase === 'enrolling' && (
              <div>
                <p className="form-text mb-2" style={{ fontSize: '0.8rem' }}>{t('security.duoScanHint')}</p>
                {duoBarcode && (
                  <img
                    src={duoBarcode}
                    alt="Duo QR code"
                    style={{ width: 200, height: 200 }}
                    className="mb-3 border rounded p-2 bg-white"
                  />
                )}
                <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>
                  <span className="spinner-border spinner-border-sm me-2" />
                  {t('security.duoWaitingForScan')}
                </p>
                <button type="button" className="fm-btn-outline btn-sm" onClick={handleDuoCancelEnroll}>
                  {t('security.cancelButton')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SecuritySettings
