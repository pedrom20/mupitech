import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaUserCircle } from 'react-icons/fa'
import { AuthContext, isAdminRole } from '@/components/app'
import { users as usersApi, ApiError } from '@/services/api'
import { showToast } from '@/utils/toast'

const ProfileDetails: React.FC = () => {
  const { t } = useTranslation()
  const { user, refresh } = useContext(AuthContext)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [receiveOfflineAlerts, setReceiveOfflineAlerts] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    setFirstName(user.first_name || '')
    setLastName(user.last_name || '')
    setEmail(user.email || '')
    setReceiveOfflineAlerts(user.receive_offline_alerts ?? true)
  }, [user])

  if (!user) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await usersApi.updateMe({
        first_name: firstName,
        last_name: lastName,
        email,
        ...(isAdminRole(user.role) ? { receive_offline_alerts: receiveOfflineAlerts } : {}),
      })
      refresh()
      showToast('success', t('account.profileSaved'))
    } catch (error) {
      showToast('error', error instanceof ApiError ? error.message : t('account.profileSaveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fm-card fm-card-accent">
      <div className="fm-card-header py-2">
        <h5 className="card-title mb-0">
          <FaUserCircle className="me-2" />
          {t('account.profileTitle')}
        </h5>
      </div>
      <div className="fm-card-body py-3">
        <form onSubmit={handleSubmit}>
          <div className="row g-3">
            <div className="col-sm-6">
              <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.username')}</label>
              <input className="form-control form-control-sm" value={user.username} disabled />
            </div>
            <div className="col-sm-6">
              <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.role')}</label>
              <input className="form-control form-control-sm" value={t(`users.role_${user.role}`)} disabled />
            </div>
            <div className="col-sm-6">
              <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.firstName')}</label>
              <input className="form-control form-control-sm" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="col-sm-6">
              <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.lastName')}</label>
              <input className="form-control form-control-sm" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="col-sm-6">
              <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('users.email')}</label>
              <input type="email" className="form-control form-control-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          {isAdminRole(user.role) && (
            <div className="form-check mt-3">
              <input
                type="checkbox"
                className="form-check-input"
                id="account-receive-offline-alerts"
                checked={receiveOfflineAlerts}
                onChange={(e) => setReceiveOfflineAlerts(e.target.checked)}
              />
              <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="account-receive-offline-alerts">
                {t('users.receiveOfflineAlerts')}
              </label>
              <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('users.receiveOfflineAlertsHint')}</div>
            </div>
          )}

          <button type="submit" className="fm-btn-primary btn-sm mt-3" disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </form>
      </div>
    </div>
  )
}

export default ProfileDetails
