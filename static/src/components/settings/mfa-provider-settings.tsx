import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FaSave, FaCheckCircle, FaTimesCircle, FaUserShield, FaMicrosoft } from 'react-icons/fa'
import Swal from 'sweetalert2'
import { mfaProviders, dualMfa } from '@/services/api'
import { showToast } from '@/utils/toast'
import { MFA_METHOD_ICON } from '@/utils/mfaIcons'
import type { MFAProviderConfigStatus } from '@/types'

const DuoIcon = MFA_METHOD_ICON.duo
const PrivacyIDEAIcon = MFA_METHOD_ICON.privacyidea
const AuthPointIcon = MFA_METHOD_ICON.authpoint

const SECRET_PLACEHOLDER_SET = '••••••••'
const SECRET_PLACEHOLDER_UNSET = ''

const DUAL_MFA_ROLES = ['viewer', 'editor_simplificado', 'editor_simplificado_full', 'editor', 'admin', 'superadmin'] as const

type ProviderTab = 'dual' | 'duo' | 'privacyidea' | 'authpoint' | 'm365'

const MFAProviderSettings: React.FC = () => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ProviderTab>('dual')
  const [status, setStatus] = useState<MFAProviderConfigStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const [dualRoles, setDualRoles] = useState<string[]>([])
  const [dualLoading, setDualLoading] = useState(true)
  const [dualSaving, setDualSaving] = useState(false)

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

  const [m365TenantId, setM365TenantId] = useState('')
  const [m365ClientId, setM365ClientId] = useState('')
  const [m365ClientSecret, setM365ClientSecret] = useState('')
  const [m365EnforceSso, setM365EnforceSso] = useState(false)
  const [m365Saving, setM365Saving] = useState(false)

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
      setM365TenantId(res.m365.tenant_id)
      setM365ClientId(res.m365.client_id)
      setM365EnforceSso(res.m365.enforce_sso === 'true')
    }).catch(() => {}).finally(() => setLoading(false))
  }

  const loadDualPolicy = () => {
    setDualLoading(true)
    dualMfa.status().then((res) => {
      setDualRoles(res.require_dual_roles || [])
    }).catch(() => {}).finally(() => setDualLoading(false))
  }

  useEffect(() => { load(); loadDualPolicy() }, [])

  const toggleDualRole = (role: string) => {
    setDualRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleSaveDualPolicy = () => {
    setDualSaving(true)
    dualMfa.savePolicy(dualRoles).then((res) => {
      setDualRoles(res.require_dual_roles)
      showToast('success', t('common.success'))
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setDualSaving(false))
  }

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

  const handleSaveM365 = () => {
    setM365Saving(true)
    mfaProviders.save('m365', {
      tenant_id: m365TenantId,
      client_id: m365ClientId,
      client_secret: m365ClientSecret,
      enforce_sso: m365EnforceSso ? 'true' : '',
    }).then(() => {
      setM365ClientSecret('')
      showToast('success', t('common.success'))
      load()
    }).catch((err) => {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }).finally(() => setM365Saving(false))
  }

  if (loading || !status) {
    return (
      <div className="fm-loading">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div>
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'dual' ? 'active' : ''}`}
            onClick={() => setActiveTab('dual')}
          >
            <FaUserShield className="me-1" />
            {t('mfaProviders.dualPolicyTitle')}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'duo' ? 'active' : ''}`}
            onClick={() => setActiveTab('duo')}
          >
            <DuoIcon className="me-1" />
            Duo Security
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'privacyidea' ? 'active' : ''}`}
            onClick={() => setActiveTab('privacyidea')}
          >
            <PrivacyIDEAIcon className="me-1" />
            privacyIDEA
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'authpoint' ? 'active' : ''}`}
            onClick={() => setActiveTab('authpoint')}
          >
            <AuthPointIcon className="me-1" />
            WatchGuard AuthPoint
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'm365' ? 'active' : ''}`}
            onClick={() => setActiveTab('m365')}
          >
            <FaMicrosoft className="me-1" />
            {t('mfaProviders.m365Tab')}
          </button>
        </li>
      </ul>

      {activeTab === 'dual' && (
      <div className="row g-3">
      <div className="col-lg-8">
        <div className="fm-card fm-card-accent">
          <div className="fm-card-header py-2">
            <h5 className="card-title mb-0">
              <FaUserShield className="me-2" />
              {t('mfaProviders.dualPolicyTitle')}
            </h5>
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('mfaProviders.dualPolicyDescription')}</p>
            {dualLoading ? (
              <p className="form-text mb-0">{t('common.loading')}</p>
            ) : (
              <>
                <div className="mb-3 d-flex flex-wrap gap-3">
                  {DUAL_MFA_ROLES.map((role) => (
                    <div className="form-check" key={role}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`dual-role-${role}`}
                        checked={dualRoles.includes(role)}
                        onChange={() => toggleDualRole(role)}
                      />
                      <label className="form-check-label" htmlFor={`dual-role-${role}`} style={{ fontSize: '0.85rem' }}>
                        {t(`users.role_${role}`)}
                      </label>
                    </div>
                  ))}
                </div>
                <button className="fm-btn-primary btn-sm" onClick={handleSaveDualPolicy} disabled={dualSaving}>
                  <FaSave />
                  {dualSaving ? t('common.loading') : t('common.save')}
                </button>
              </>
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
          <div className="fm-card-header py-2 d-flex align-items-center justify-content-between">
            <h5 className="card-title mb-0">
              <DuoIcon className="me-2" />
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
      </div>
      )}

      {activeTab === 'privacyidea' && (
      <div className="row g-3">
      <div className="col-lg-8">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2 d-flex align-items-center justify-content-between">
            <h5 className="card-title mb-0">
              <PrivacyIDEAIcon className="me-2" />
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
      </div>
      )}

      {activeTab === 'authpoint' && (
      <div className="row g-3">
      <div className="col-lg-8">
        <div className="fm-card h-100">
          <div className="fm-card-header py-2 d-flex align-items-center justify-content-between">
            <h5 className="card-title mb-0">
              <AuthPointIcon className="me-2" />
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
      )}

      {activeTab === 'm365' && (
      <div className="row g-3">
      <div className="col-lg-8">
        <div className="fm-card fm-card-accent h-100">
          <div className="fm-card-header py-2 d-flex align-items-center justify-content-between">
            <h5 className="card-title mb-0">
              <FaMicrosoft className="me-2" />
              {t('mfaProviders.m365Tab')}
            </h5>
            {status.m365.configured ? (
              <span className="badge bg-success"><FaCheckCircle className="me-1" />{t('mfaProviders.configured')}</span>
            ) : (
              <span className="badge bg-secondary"><FaTimesCircle className="me-1" />{t('mfaProviders.notConfigured')}</span>
            )}
          </div>
          <div className="fm-card-body py-3">
            <p className="form-text mb-3" style={{ fontSize: '0.8rem' }}>{t('mfaProviders.m365Description')}</p>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Tenant ID</label>
              <input type="text" className="form-control form-control-sm" value={m365TenantId} onChange={(e) => setM365TenantId(e.target.value)} />
            </div>
            <div className="mb-2">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Client ID</label>
              <input type="text" className="form-control form-control-sm" value={m365ClientId} onChange={(e) => setM365ClientId(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>Client Secret</label>
              <input
                type="password"
                className="form-control form-control-sm"
                value={m365ClientSecret}
                onChange={(e) => setM365ClientSecret(e.target.value)}
                placeholder={status.m365.client_secret.set ? SECRET_PLACEHOLDER_SET : SECRET_PLACEHOLDER_UNSET}
              />
              {status.m365.client_secret.set && (
                <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('mfaProviders.leaveBlankToKeep')}</div>
              )}
            </div>
            <div className="form-check form-switch mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id="m365-enforce-sso"
                checked={m365EnforceSso}
                onChange={(e) => setM365EnforceSso(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="m365-enforce-sso">
                <span className="fw-semibold d-block">{t('mfaProviders.m365EnforceSso')}</span>
                <span className="form-text" style={{ fontSize: '0.78rem' }}>{t('mfaProviders.m365EnforceSsoHint')}</span>
              </label>
            </div>
            <button className="fm-btn-primary btn-sm" onClick={handleSaveM365} disabled={m365Saving}>
              <FaSave />
              {m365Saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  )
}

export default MFAProviderSettings
