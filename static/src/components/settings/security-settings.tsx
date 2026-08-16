import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaShieldAlt, FaCheckCircle, FaMobileAlt, FaKey, FaUserShield, FaEnvelope } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { mfa, duo, privacyidea, emailOtp, dualMfa, ApiError } from '@/services/api'
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
// Email codes need an 'unavailable' state like Duo's (SMTP might not
// be configured — see mfa.email_otp.email_otp_configured()), but
// unlike Duo the enroll step itself sends the confirmation code
// (there's no separate QR/scan step), so 'enrolling' here just means
// "a code was just emailed, waiting for it to be typed in".
type EmailPhase = 'loading' | 'unavailable' | 'disabled' | 'enrolling' | 'enabled'

type SettingsTab = 'totp' | 'duo' | 'privacyidea' | 'email' | 'dual'

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
  const [piTokenType, setPiTokenType] = useState<'totp' | 'push'>('totp')
  const [piEnabledTokenType, setPiEnabledTokenType] = useState<'totp' | 'push' | null>(null)
  const [piOtpauthUri, setPiOtpauthUri] = useState('')
  const [piQrPng, setPiQrPng] = useState('')
  const [piCode, setPiCode] = useState('')
  const [piPassword, setPiPassword] = useState('')
  const [piBusy, setPiBusy] = useState(false)
  const piPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [activeTab, setActiveTab] = useState<SettingsTab>('totp')

  const [emailPhase, setEmailPhase] = useState<EmailPhase>('loading')
  const [emailAddress, setEmailAddress] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)

  const [dualSelfOptIn, setDualSelfOptIn] = useState(false)
  const [dualRoleRequired, setDualRoleRequired] = useState(false)
  const [dualEligible, setDualEligible] = useState(false)
  const [dualLoading, setDualLoading] = useState(true)
  const [dualBusy, setDualBusy] = useState(false)

  const loadDualStatus = () => {
    dualMfa.status().then((res) => {
      setDualSelfOptIn(res.self_opt_in)
      setDualRoleRequired(res.role_required)
      setDualEligible(res.eligible)
    }).catch(() => {}).finally(() => setDualLoading(false))
  }

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
      setPiEnabledTokenType(res.token_type)
    }).catch(() => setPiConfigured(false))
  }

  const stopPIPolling = () => {
    if (piPollRef.current) { clearInterval(piPollRef.current); piPollRef.current = null }
  }

  const loadEmailStatus = () => {
    emailOtp.status().then((res) => {
      setEmailAddress(res.email)
      setEmailPhase(!res.configured ? 'unavailable' : res.enabled ? 'enabled' : 'disabled')
    }).catch(() => setEmailPhase('unavailable'))
  }

  useEffect(() => {
    loadStatus()
    loadDuoStatus()
    loadPIStatus()
    loadEmailStatus()
    loadDualStatus()
    return () => { stopDuoPolling(); stopPIPolling() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDualToggle = (enabled: boolean) => {
    setDualBusy(true)
    dualMfa.selfToggle(enabled).then((res) => {
      setDualSelfOptIn(res.self_opt_in)
      showToast('success', t('common.success'))
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.dualMfaToggleError'),
      })
    }).finally(() => setDualBusy(false))
  }

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
      loadDualStatus()
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
      loadDualStatus()
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
        loadDualStatus()
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
      loadDualStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.disableError'),
      })
    }).finally(() => setDuoBusy(false))
  }

  const pollPIPushConfirm = () => {
    privacyidea.confirm().then((res) => {
      if ('success' in res) {
        stopPIPolling()
        showToast('success', t('security.enabledSuccess'))
        loadPIStatus()
        loadDualStatus()
      }
    }).catch(() => {
      // Transient errors (network blip) just get retried on the next tick.
    })
  }

  const handlePIEnroll = () => {
    setPiBusy(true)
    privacyidea.enroll(piTokenType).then((res) => {
      setPiOtpauthUri(res.otpauth_uri)
      setPiQrPng(res.qr_png_base64)
      setPiCode('')
      setPiPhase('enrolling')
      if (piTokenType === 'push') {
        piPollRef.current = setInterval(pollPIPushConfirm, DUO_POLL_INTERVAL_MS)
      }
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
      loadDualStatus()
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
    stopPIPolling()
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
      loadDualStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.disableError'),
      })
    }).finally(() => setPiBusy(false))
  }

  const handleEmailEnroll = () => {
    setEmailBusy(true)
    emailOtp.enroll().then((res) => {
      setEmailAddress(res.email)
      setEmailCode('')
      setEmailPhase('enrolling')
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.emailEnrollError'),
      })
    }).finally(() => setEmailBusy(false))
  }

  const submitEmailConfirmCode = (submittedCode: string) => {
    if (submittedCode.length !== 6) return
    setEmailBusy(true)
    emailOtp.confirm(submittedCode).then(() => {
      showToast('success', t('security.enabledSuccess'))
      loadEmailStatus()
      loadDualStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.confirmError'),
      })
      setEmailCode('')
    }).finally(() => setEmailBusy(false))
  }

  const handleEmailConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    submitEmailConfirmCode(emailCode)
  }

  const handleEmailCancelEnroll = () => {
    setEmailCode('')
    setEmailPhase('disabled')
  }

  const handleEmailDisable = async (e: React.FormEvent) => {
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

    setEmailBusy(true)
    emailOtp.disable(emailPassword).then(() => {
      showToast('success', t('security.disabledSuccess'))
      setEmailPassword('')
      loadEmailStatus()
      loadDualStatus()
    }).catch((error) => {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : t('security.disableError'),
      })
    }).finally(() => setEmailBusy(false))
  }

  return (
    <div>
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'totp' ? 'active' : ''}`}
            onClick={() => setActiveTab('totp')}
          >
            <FaShieldAlt className="me-1" />
            {t('security.mfaTitle')}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'duo' ? 'active' : ''}`}
            onClick={() => setActiveTab('duo')}
          >
            <FaMobileAlt className="me-1" />
            {t('security.duoTitle')}
          </button>
        </li>
        {piConfigured && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'privacyidea' ? 'active' : ''}`}
              onClick={() => setActiveTab('privacyidea')}
            >
              <FaKey className="me-1" />
              {t('security.piTitle')}
            </button>
          </li>
        )}
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'email' ? 'active' : ''}`}
            onClick={() => setActiveTab('email')}
          >
            <FaEnvelope className="me-1" />
            {t('security.emailTitle')}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'dual' ? 'active' : ''}`}
            onClick={() => setActiveTab('dual')}
          >
            <FaUserShield className="me-1" />
            {t('security.dualMfaTitle')}
          </button>
        </li>
      </ul>

      {activeTab === 'totp' && (
      <div className="row g-3">
      <div className="col-lg-8">
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
      </div>
      )}

      {activeTab === 'duo' && (
      <div className="row g-3">
      <div className="col-lg-8">
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
      )}

      {activeTab === 'privacyidea' && piConfigured && (
      <div className="row g-3">
        <div className="col-lg-8">
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
                  <div className="mb-3 d-flex gap-3">
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="pi-token-type"
                        id="pi-token-totp"
                        checked={piTokenType === 'totp'}
                        onChange={() => setPiTokenType('totp')}
                      />
                      <label className="form-check-label" htmlFor="pi-token-totp" style={{ fontSize: '0.85rem' }}>
                        {t('security.piTypeTotp')}
                      </label>
                    </div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="pi-token-type"
                        id="pi-token-push"
                        checked={piTokenType === 'push'}
                        onChange={() => setPiTokenType('push')}
                      />
                      <label className="form-check-label" htmlFor="pi-token-push" style={{ fontSize: '0.85rem' }}>
                        {t('security.piTypePush')}
                      </label>
                    </div>
                  </div>
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
                    {piEnabledTokenType && ` — ${t(piEnabledTokenType === 'push' ? 'security.piTypePush' : 'security.piTypeTotp')}`}
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

              {piPhase === 'enrolling' && piTokenType === 'push' && (
                <div>
                  <p className="form-text mb-2" style={{ fontSize: '0.8rem' }}>{t('security.piScanQrHintPush')}</p>
                  {piQrPng && (
                    <img
                      src={`data:image/png;base64,${piQrPng}`}
                      alt="QR code"
                      style={{ width: 200, height: 200, imageRendering: 'pixelated' }}
                      className="mb-3 border rounded p-2 bg-white"
                    />
                  )}
                  <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>
                    <span className="spinner-border spinner-border-sm me-2" />
                    {t('security.piWaitingForApp')}
                  </p>
                  <button type="button" className="fm-btn-outline btn-sm" onClick={handlePICancelEnroll}>
                    {t('security.cancelButton')}
                  </button>
                </div>
              )}

              {piPhase === 'enrolling' && piTokenType === 'totp' && (
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
      </div>
      )}

      {activeTab === 'email' && (
      <div className="row g-3">
      <div className="col-lg-8">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaEnvelope className="me-2" />
              {t('security.emailTitle')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('security.emailDescription')}</p>

            {emailPhase === 'loading' && (
              <p className="form-text mb-0">{t('common.loading')}</p>
            )}

            {emailPhase === 'unavailable' && (
              <span className="badge bg-light text-muted border">{t('security.emailUnavailable')}</span>
            )}

            {emailPhase === 'disabled' && (
              <>
                <span className="badge bg-secondary mb-3">{t('security.statusDisabled')}</span>
                <div>
                  <button
                    type="button"
                    className="fm-btn-primary"
                    onClick={handleEmailEnroll}
                    disabled={emailBusy}
                  >
                    <FaEnvelope className="me-1" />
                    {t('security.emailEnableButton')}
                  </button>
                </div>
              </>
            )}

            {emailPhase === 'enabled' && (
              <>
                <span className="badge bg-success mb-3">
                  <FaCheckCircle className="me-1" />
                  {t('security.statusEnabled')}
                </span>
                <form onSubmit={handleEmailDisable} className="d-flex flex-wrap gap-2 align-items-end">
                  <div>
                    <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                      {t('security.currentPasswordLabel')}
                    </label>
                    <input
                      type="password"
                      className="form-control form-control-sm"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="fm-btn-outline btn-sm" disabled={emailBusy || !emailPassword}>
                    {t('security.disableButton')}
                  </button>
                </form>
              </>
            )}

            {emailPhase === 'enrolling' && (
              <div>
                <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>
                  {t('security.emailSentHint', { email: emailAddress })}
                </p>
                <form onSubmit={handleEmailConfirm}>
                  <div className="mb-3">
                    <label className="form-label fw-semibold mb-1 d-block" style={{ fontSize: '0.85rem' }}>
                      {t('security.enterCodeLabel')}
                    </label>
                    <CodeInput value={emailCode} onChange={setEmailCode} onComplete={submitEmailConfirmCode} disabled={emailBusy} autoFocus />
                  </div>
                  <div className="d-flex gap-2">
                    <button type="submit" className="fm-btn-primary btn-sm" disabled={emailBusy || emailCode.length !== 6}>
                      {t('security.confirmButton')}
                    </button>
                    <button type="button" className="fm-btn-outline btn-sm" onClick={handleEmailEnroll} disabled={emailBusy}>
                      {t('security.emailResendButton')}
                    </button>
                    <button type="button" className="fm-btn-outline btn-sm" onClick={handleEmailCancelEnroll} disabled={emailBusy}>
                      {t('security.cancelButton')}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      )}

      {activeTab === 'dual' && (
      <div className="row g-3">
      <div className="col-lg-8">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaUserShield className="me-2" />
              {t('security.dualMfaTitle')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('security.dualMfaDescription')}</p>

            {dualLoading ? (
              <p className="form-text mb-0">{t('common.loading')}</p>
            ) : dualRoleRequired ? (
              <span className="badge bg-info-subtle text-info-emphasis">{t('security.dualMfaRoleRequired')}</span>
            ) : !dualEligible ? (
              <span className="badge bg-light text-muted border">{t('security.dualMfaNotEligible')}</span>
            ) : (
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  id="dual-mfa-self-toggle"
                  checked={dualSelfOptIn}
                  disabled={dualBusy}
                  onChange={(e) => handleDualToggle(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="dual-mfa-self-toggle">
                  {dualSelfOptIn ? t('security.statusEnabled') : t('security.statusDisabled')}
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  )
}

export default SecuritySettings
