import React from 'react'
import { useTranslation } from 'react-i18next'
import { FaUserCircle } from 'react-icons/fa'
import SecuritySettings from '@/components/settings/security-settings'

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

      <SecuritySettings />
    </>
  )
}

export default AccountPage
