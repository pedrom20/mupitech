import React, { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { FaHourglassHalf, FaSignOutAlt } from 'react-icons/fa'
import { AuthContext } from '@/components/app'
import { auth as authApi } from '@/services/api'

/** Blocks the rest of the app for a brand-new Microsoft 365 account with
 * no role yet (user.pending_approval — see fleet_manager/m365_backend.py
 * ::get_or_create_user and access/models.py::UserAccessScope). Same
 * placement in app.tsx as onboarding-wizard.tsx's forced checklist, but
 * with nothing for the user themselves to do here — only an admin
 * assigning a role on the Users page clears this, at which point the next
 * refresh() picks up the real role and this unmounts on its own. */
const PendingApproval: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { clear } = useContext(AuthContext)

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } catch {
      // ignore — clear local state and redirect regardless
    }
    clear()
    navigate('/login')
  }

  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
      <div className="fm-card fm-card-accent text-center" style={{ maxWidth: '480px', width: '100%' }}>
        <div className="fm-card-body">
          <FaHourglassHalf size={32} className="mb-3 text-muted" />
          <h5 className="mb-2">{t('auth.pendingApproval.title')}</h5>
          <p className="text-muted mb-4">{t('auth.pendingApproval.message')}</p>
          <button type="button" className="fm-btn-outline" onClick={handleLogout}>
            <FaSignOutAlt /> {t('auth.logout')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PendingApproval
