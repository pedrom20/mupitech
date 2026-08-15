import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaShieldAlt, FaCheckCircle, FaMobileAlt, FaKey } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { mfa, duo, privacyidea, ApiError } from '@/services/api'
import { showToast } from '@/utils/toast'
import CodeInput from '@/components/shared/code-input'

type Phase = 'loading' | 'disabled' | 'enrolling' | 'enabled'
type DuoPhase = 'loading' | 'unavailable' | 'disabled' | 'enrolling' | 'enabled'
// privacyIDEA is code-based like TOTP, no 'unavailable' distinction is
// needed in the UI the same way Duo has one — the card itself just
// doesn't render at all when the backend says it's not configured
// (see the `piConfigured` check below), rather than showing a disabled
// state for something the operator can't act on either way.
type PIPhase = 'loading' | 'disabled' | 'enrolling' | 'enabled'

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

  const [piConfigured, setPiConfigured] = useState(false)
  const [piPhase, setPiPhase] = useState<PIPhase>('loading')
  const [piOtpauthUri, setPiOtpauthUri] = useState('')
  const [piQrPng, setPiQrPng] = useState('')
  const [piCode, setPiCode] = useState('')
  const [piPassword, setPiPassword] = useState('')
  const [piBusy, setPiBusy] = useState(false)

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

  const loadPIStatus = () => {
    privacyidea.status().then((res) => {
      setPiConfigured(res.configured)
      setPiPhase(res.enabled ? 'enabled' : 'disabled')
    }).catch(() => setPiConfigured(false))
  }

  useEffect(() => {
    loadStatus()
    loadDuoStatus()
    loadPIStatus()
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

  const submitConfirmCode = (submittedCode: string) => {
    if (submittedCode.length !== 6) return
    setBusy(true)
    mfa.confirm(submittedCode).then(() => {
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

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    submitConfirmCode(code)
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

  const handlePIEnroll = () => {
    setPiBusy(true)
    privacyidea.enroll().then((res) => {
      setPiOtpauthUri(res.otpauth_uri)
      setPiQrPng(res.qr_png_base64)
      setPiCode('')
      setPiPhase('enrolling')
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.piEnrollError'),
      })
    }).finally(() => setPiBusy(false))
  }

  const submitPIConfirmCode = (submittedCode: string) => {
    if (submittedCode.length !== 6) return
    setPiBusy(true)
    privacyidea.confirm(submittedCode).then(() => {
      showToast('success', t('security.enabledSuccess'))
      loadPIStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.confirmError'),
      })
      setPiCode('')
    }).finally(() => setPiBusy(false))
  }

  const handlePIConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    submitPIConfirmCode(piCode)
  }

  const handlePICancelEnroll = () => {
    setPiOtpauthUri('')
    setPiQrPng('')
    setPiCode('')
    setPiPhase('disabled')
  }

  const handlePIDisable = async (e: React.FormEvent) => {
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

    setPiBusy(true)
    privacyidea.disable(piPassword).then(() => {
      showToast('success', t('security.disabledSuccess'))
      setPiPassword('')
      loadPIStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.disableError'),
      })
    }).finally(() => setPiBusy(false))
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
                  <div className="mb-3">
                    <label className="form-label fw-semibold mb-1 d-block" style={{ fontSize: '0.85rem' }}>
                      {t('security.enterCodeLabel')}
                    </label>
                    <CodeInput value={code} onChange={setCode} onComplete={submitConfirmCode} disabled={busy} autoFocus />
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

      {piConfigured && (
        <div className="col-lg-6">
          <div className="fm-card fm-card-accent h-100">
            <div className="fm-card-header py-2">
              <h5 className="card-title mb-0">
                <FaKey className="me-2" />
                {t('security.piTitle')}
              </h5>
            </div>
            <div className="fm-card-body py-3">
              <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('security.piDescription')}</p>

              {piPhase === 'loading' && (
                <p className="form-text mb-0">{t('common.loading')}</p>
              )}

              {piPhase === 'disabled' && (
                <>
                  <span className="badge bg-secondary mb-3">{t('security.statusDisabled')}</span>
                  <div>
                    <button
                      type="button"
                      className="fm-btn-primary"
                      onClick={handlePIEnroll}
                      disabled={piBusy}
                    >
                      <FaKey className="me-1" />
                      {t('security.piEnableButton')}
                    </button>
                  </div>
                </>
              )}

              {piPhase === 'enabled' && (
                <>
                  <span className="badge bg-success mb-3">
                    <FaCheckCircle className="me-1" />
                    {t('security.statusEnabled')}
                  </span>
                  <form onSubmit={handlePIDisable} className="d-flex flex-wrap gap-2 align-items-end">
                    <div>
                      <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                        {t('security.currentPasswordLabel')}
                      </label>
                      <input
                        type="password"
                        className="form-control form-control-sm"
                        value={piPassword}
                        onChange={(e) => setPiPassword(e.target.value)}
                        required
                      />
                    </div>
                    <button type="submit" className="fm-btn-outline btn-sm" disabled={piBusy || !piPassword}>
                      {t('security.disableButton')}
                    </button>
                  </form>
                </>
              )}

              {piPhase === 'enrolling' && (
                <div>
                  <p className="form-text mb-2" style={{ fontSize: '0.8rem' }}>{t('security.scanQrHint')}</p>
                  {piQrPng && (
                    <img
                      src={`data:image/png;base64,${piQrPng}`}
                      alt="QR code"
                      style={{ width: 200, height: 200, imageRendering: 'pixelated' }}
                      className="mb-3 border rounded p-2 bg-white"
                    />
                  )}
                  <p className="form-text mb-1" style={{ fontSize: '0.8rem' }}>{t('security.manualEntryLabel')}</p>
                  <code className="d-block mb-3" style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>
                    {piOtpauthUri.match(/secret=([^&]+)/)?.[1] || piOtpauthUri}
                  </code>

                  <form onSubmit={handlePIConfirm}>
                    <div className="mb-3">
                      <label className="form-label fw-semibold mb-1 d-block" style={{ fontSize: '0.85rem' }}>
                        {t('security.enterCodeLabel')}
                      </label>
                      <CodeInput value={piCode} onChange={setPiCode} onComplete={submitPIConfirmCode} disabled={piBusy} autoFocus />
                    </div>
                    <div className="d-flex gap-2">
                      <button type="submit" className="fm-btn-primary btn-sm" disabled={piBusy || piCode.length !== 6}>
                        {t('security.confirmButton')}
                      </button>
                      <button type="button" className="fm-btn-outline btn-sm" onClick={handlePICancelEnroll} disabled={piBusy}>
                        {t('security.cancelButton')}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SecuritySettings
