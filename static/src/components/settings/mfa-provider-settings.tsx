import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FaMobileAlt, FaServer, FaShieldAlt, FaSave, FaCheckCircle, FaTimesCircle } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { mfaProviders } from '@/services/api'
import { showToast } from '@/utils/toast'
import type { MFAProviderConfigStatus } from '@/types'

const SECRET_PLACEHOLDER_SET = '••••••••'
const SECRET_PLACEHOLDER_UNSET = ''

const MFAProviderSettings: React.FC = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<MFAProviderConfigStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const [duoIkey, setDuoIkey] = useState('')
  const [duoSkey, setDuoSkey] = useState('')
  const [duoHost, setDuoHost] = useState('')
  const [duoSaving, setDuoSaving] = useState(false)

  const [piUrl, setPiUrl] = useState('')
  const [piAdminUser, setPiAdminUser] = useState('')
  const [piAdminPassword, setPiAdminPassword] = useState('')
  const [piRealm, setPiRealm] = useState('')
  const [piResolver, setPiResolver] = useState('')
  const [piSaving, setPiSaving] = useState(false)

  const [apClientId, setApClientId] = useState('')
  const [apClientSecret, setApClientSecret] = useState('')
  const [apSaving, setApSaving] = useState(false)

  const load = () => {
    setLoading(true)
    mfaProviders.status().then((res) => {
      setStatus(res)
      setDuoIkey(res.duo.ikey)
      setDuoHost(res.duo.host)
      setPiUrl(res.privacyidea.url)
      setPiAdminUser(res.privacyidea.admin_user)
      setPiRealm(res.privacyidea.realm)
      setPiResolver(res.privacyidea.resolver)
      setApClientId(res.authpoint.client_id)
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleSaveDuo = () => {
    setDuoSaving(true)
    mfaProviders.save('duo', { ikey: duoIkey, skey: duoSkey, host: duoHost }).then(() => {
      setDuoSkey('')
      showToast('success', t('common.success'))
      load()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setDuoSaving(false))
  }

  const handleSavePI = () => {
    setPiSaving(true)
    mfaProviders.save('privacyidea', {
      url: piUrl, admin_user: piAdminUser, admin_password: piAdminPassword, realm: piRealm, resolver: piResolver,
    }).then(() => {
      setPiAdminPassword('')
      showToast('success', t('common.success'))
      load()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setPiSaving(false))
  }

  const handleSaveAuthPoint = () => {
    setApSaving(true)
    mfaProviders.save('authpoint', { client_id: apClientId, client_secret: apClientSecret }).then(() => {
      setApClientSecret('')
      showToast('success', t('common.success'))
      load()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setApSaving(false))
  }

  if (loading || !status) {
    return (
      <div className="fm-loading">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="row g-3">
      {/* Duo */}
      <div className="col-lg-6">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2 d-flex align-items-center justify-content-between">
            <h5 className="card-title mb-0">
              <FaMobileAlt className="me-2" />
              Duo Security
            </h5>
            {status.duo.configured ? (
              <span className="badge bg-success"><FaCheckCircle className="me-1" />{t('mfaProviders.configured')}</span>
            ) : (
              <span className="badge bg-secondary"><FaTimesCircle className="me-1" />{t('mfaProviders.notConfigured')}</span>
            )}
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('mfaProviders.duoDescription')}</p>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Integration Key</label>
              <input type="text" className="form-control form-control-sm" value={duoIkey} onChange={(e) => setDuoIkey(e.target.value)} />
            </div>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Secret Key</label>
              <input
                type="password"
                className="form-control form-control-sm"
                value={duoSkey}
                onChange={(e) => setDuoSkey(e.target.value)}
                placeholder={status.duo.skey.set ? SECRET_PLACEHOLDER_SET : SECRET_PLACEHOLDER_UNSET}
              />
              {status.duo.skey.set && (
                <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('mfaProviders.leaveBlankToKeep')}</div>
              )}
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>API Hostname</label>
              <input type="text" className="form-control form-control-sm" value={duoHost} onChange={(e) => setDuoHost(e.target.value)} placeholder="api-xxxxxxxx.duosecurity.com" />
            </div>
            <button className="fm-btn-primary btn-sm" onClick={handleSaveDuo} disabled={duoSaving}>
              <FaSave />
              {duoSaving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </div>

      {/* privacyIDEA */}
      <div className="col-lg-6">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2 d-flex align-items-center justify-content-between">
            <h5 className="card-title mb-0">
              <FaServer className="me-2" />
              privacyIDEA
            </h5>
            {status.privacyidea.configured ? (
              <span className="badge bg-success"><FaCheckCircle className="me-1" />{t('mfaProviders.configured')}</span>
            ) : (
              <span className="badge bg-secondary"><FaTimesCircle className="me-1" />{t('mfaProviders.notConfigured')}</span>
            )}
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('mfaProviders.privacyideaDescription')}</p>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Server URL</label>
              <input type="text" className="form-control form-control-sm" value={piUrl} onChange={(e) => setPiUrl(e.target.value)} placeholder="https://privacyidea.example.com" />
            </div>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Admin User</label>
              <input type="text" className="form-control form-control-sm" value={piAdminUser} onChange={(e) => setPiAdminUser(e.target.value)} />
            </div>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Admin Password</label>
              <input
                type="password"
                className="form-control form-control-sm"
                value={piAdminPassword}
                onChange={(e) => setPiAdminPassword(e.target.value)}
                placeholder={status.privacyidea.admin_password.set ? SECRET_PLACEHOLDER_SET : SECRET_PLACEHOLDER_UNSET}
              />
              {status.privacyidea.admin_password.set && (
                <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('mfaProviders.leaveBlankToKeep')}</div>
              )}
            </div>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Realm</label>
              <input type="text" className="form-control form-control-sm" value={piRealm} onChange={(e) => setPiRealm(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Resolver</label>
              <input type="text" className="form-control form-control-sm" value={piResolver} onChange={(e) => setPiResolver(e.target.value)} />
              <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('mfaProviders.piResolverHint')}</div>
            </div>
            <button className="fm-btn-primary btn-sm" onClick={handleSavePI} disabled={piSaving}>
              <FaSave />
              {piSaving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </div>

      {/* AuthPoint */}
      <div className="col-lg-6">
        <div className="fm-card h-100">
          <div className="fm-card-header py-2 d-flex align-items-center justify-content-between">
            <h5 className="card-title mb-0">
              <FaShieldAlt className="me-2" />
              WatchGuard AuthPoint
            </h5>
            <span className="badge bg-secondary">{t('mfaProviders.comingSoon')}</span>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('mfaProviders.authpointDescription')}</p>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Client ID</label>
              <input type="text" className="form-control form-control-sm" value={apClientId} onChange={(e) => setApClientId(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Client Secret</label>
              <input
                type="password"
                className="form-control form-control-sm"
                value={apClientSecret}
                onChange={(e) => setApClientSecret(e.target.value)}
                placeholder={status.authpoint.client_secret.set ? SECRET_PLACEHOLDER_SET : SECRET_PLACEHOLDER_UNSET}
              />
              {status.authpoint.client_secret.set && (
                <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('mfaProviders.leaveBlankToKeep')}</div>
              )}
            </div>
            <button className="fm-btn-outline btn-sm" onClick={handleSaveAuthPoint} disabled={apSaving}>
              <FaSave />
              {apSaving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MFAProviderSettings
