import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { FaGithub, FaSync } from 'react-icons/fa'
import { system } from '@/services/api'
import { APP_VERSION } from '../changelog'
import { AuthContext } from '@/components/app'
import { useTapTrigger } from '@/hooks/use-tap-trigger'

interface FooterProps {
  onSecretTrigger?: () => void
}

const Footer: React.FC<FooterProps> = ({ onSecretTrigger }) => {
  const { t } = useTranslation()
  const { user } = useContext(AuthContext)
  const currentYear = new Date().getFullYear()
  const registerTap = useTapTrigger(() => onSecretTrigger?.())

  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [versionMismatch, setVersionMismatch] = useState(false)
  const [newVersion, setNewVersion] = useState('')

  useEffect(() => {
    if (!user) return undefined

    const check = () => {
      system.checkForUpdate().then((res) => {
        setUpdateAvailable(res.update_available)
      }).catch(() => {})

      // Check if backend version differs from frontend bundle
      system.getVersion().then((res) => {
        if (res.version && res.version !== APP_VERSION) {
          setVersionMismatch(true)
          setNewVersion(res.version)
        }
      }).catch(() => {})
    }
    check()
    const interval = setInterval(check, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user])

  return (
    <>
      <footer className="fm-footer">
        <div className="footer-inner">
          <p className="footer-text">
            &copy; {currentYear}{' '}
            <a
              href="https://github.com/pedrom20/mupitech"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('footer.copyright')}
            </a>
            {/* Attribution credit, not legally load-bearing on its own —
                the first thing dropped on mobile (footer.upstream-link
                below) when space is tight. */}
            <span className="footer-upstream-link">
              {' — '}
              <a
                href="https://github.com/Screenly/Anthias"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('footer.upstream')}
              </a>
            </span>
          </p>
          <ul className="footer-links">
            <li>
              <Link
                to="/changelog"
                className="fm-version-badge"
                onClick={(e) => {
                  if (registerTap()) e.preventDefault()
                }}
              >
                v{APP_VERSION}
                {updateAvailable && <span className="fm-update-dot" title={t('updates.newVersion')} />}
              </Link>
            </li>
            <li className="footer-github-item">
              <a
                href="https://github.com/pedrom20/mupitech"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FaGithub style={{ marginRight: '0.3rem', verticalAlign: '-2px' }} />
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </footer>

      {versionMismatch && (
        <div className="fm-update-banner">
          <span>{t('updates.reloadRequired', { version: newVersion })}</span>
          <button className="fm-update-banner-btn" onClick={() => window.location.reload()}>
            <FaSync />
            {t('updates.reload')}
          </button>
        </div>
      )}
    </>
  )
}

export default Footer
