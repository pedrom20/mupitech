import React from 'react'
import { useTranslation } from 'react-i18next'
import { FaUserCircle } from 'react-icons/fa'
import SecuritySettings from '@/components/settings/security-settings'
import ProfileDetails from './profile-details'

const AccountPage: React.FC = () => {
  const { t } = useTranslation()

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

      <div className="mb-3">
        <ProfileDetails />
      </div>

      <SecuritySettings />
    </>
  )
}

export default AccountPage
