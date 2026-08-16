import React from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { FaUserCircle } from 'react-icons/fa'
import SecuritySettings from '@/components/settings/security-settings'
import ProfileDetails from './profile-details'

const AccountPage: React.FC = () => {
  const { t } = useTranslation()
  // Synced to ?tab= (not plain useState) — same reasoning as
  // settings.tsx's activeSettingsTab: a page refresh should stay on
  // whichever tab was open instead of snapping back to 'profile'.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'profile'
  const setActiveTab = (tab: string) => setSearchParams({ tab }, { replace: true })

  const tabs = [
    { id: 'profile', label: t('account.tabProfile') },
    { id: 'security', label: t('account.tabSecurity') },
  ]

  return (
    <>
      <div className="fm-page-header">
        <div>
          <h1 className="page-title">
            <FaUserCircle className="page-icon" />
            {t('account.title')}
          </h1>
          <p className="page-subtitle">{t('account.subtitle')}</p>
        </div>
      </div>

      <div className="d-flex flex-column flex-md-row gap-3">
        {/* Mobile: a dropdown instead of a horizontally-scrolling button strip */}
        <select
          className="form-select d-md-none"
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value)}
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>{tab.label}</option>
          ))}
        </select>

        <div className="fm-settings-nav d-none d-md-flex flex-column gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`btn btn-sm text-start ${activeTab === tab.id ? 'fm-btn-primary' : 'fm-btn-outline'}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          {activeTab === 'profile' && <ProfileDetails />}
          {activeTab === 'security' && <SecuritySettings />}
        </div>
      </div>
    </>
  )
}

export default AccountPage
