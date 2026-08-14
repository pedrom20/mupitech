import React, { useState, useEffect, useContext, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FaThLarge, FaPhotoVideo, FaHistory, FaCog, FaBars, FaTimes, FaDesktop, FaLayerGroup, FaMapMarkerAlt, FaListUl, FaUserCircle, FaUserCog, FaSignOutAlt, FaChevronDown, FaServer, FaSitemap, FaCalendarAlt } from 'react-icons/fa'
import LanguageSwitcher from './language-switcher'
import { auth as authApi, system as systemApi } from '@/services/api'
import { AuthContext } from '@/components/app'
import { useTapTrigger } from '@/hooks/use-tap-trigger'

const FLEET_ROUTES = ['/fleet', '/players', '/groups', '/locations']

const FleetMenu: React.FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const { t } = useTranslation()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLLIElement>(null)

  const isActive = FLEET_ROUTES.some((r) => location.pathname.startsWith(r))

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const items = [
    { to: '/fleet', icon: <FaSitemap className="nav-icon" />, label: t('nav.fleetOverview') },
    { to: '/players', icon: <FaDesktop className="nav-icon" />, label: t('nav.players') },
    { to: '/groups', icon: <FaLayerGroup className="nav-icon" />, label: t('nav.groups') },
    { to: '/locations', icon: <FaMapMarkerAlt className="nav-icon" />, label: t('nav.locations') },
  ]

  return (
    <li className="position-relative" ref={dropdownRef}>
      <button
        type="button"
        className={`nav-link d-flex align-items-center gap-1 ${isActive ? 'active' : ''}`}
        style={{ border: 'none', background: 'transparent', font: 'inherit' }}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <FaServer className="nav-icon" />
        {t('nav.fleet')}
        <FaChevronDown style={{ fontSize: '0.7em' }} />
      </button>
      {isOpen && (
        <div
          className="position-absolute start-0 mt-1 py-1 bg-white rounded shadow-lg"
          style={{ minWidth: '190px', zIndex: 1060 }}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive: itemActive }) =>
                `d-flex align-items-center gap-2 px-3 py-2 text-decoration-none ${itemActive ? 'fw-bold' : ''}`
              }
              style={{ fontSize: '0.875rem', color: '#1a1a2e' }}
              onClick={() => { setIsOpen(false); onNavigate() }}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </li>
  )
}

const UserMenu: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, clear } = useContext(AuthContext)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!user) return null

  const handleLogout = async () => {
    setIsOpen(false)
    try {
      await authApi.logout()
    } catch {
      // ignore — clear local state and redirect regardless
    }
    clear()
    navigate('/login')
  }

  const displayName = user.first_name || user.username

  return (
    <div className="position-relative" ref={dropdownRef}>
      <button
        className="btn-navbar d-flex align-items-center gap-2"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <FaUserCircle size={20} />
        <span className="d-none d-xl-inline">{displayName}</span>
      </button>

      {isOpen && (
        <div
          className="position-absolute end-0 mt-1 py-1 bg-white rounded shadow-lg"
          style={{ minWidth: '190px', zIndex: 1060 }}
        >
          <div className="px-3 py-2 border-bottom">
            <div className="fw-bold text-dark">{displayName}</div>
            {user.role && (
              <div className="text-muted" style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>
                {t(`users.role_${user.role}`)}
              </div>
            )}
          </div>
          <NavLink
            to="/account"
            className="d-flex align-items-center gap-2 w-100 border-0 bg-transparent px-3 py-2 text-start text-dark text-decoration-none"
            style={{ fontSize: '0.875rem' }}
            onClick={() => setIsOpen(false)}
          >
            <FaUserCog />
            <span>{t('account.title')}</span>
          </NavLink>
          <button
            className="d-flex align-items-center gap-2 w-100 border-0 bg-transparent px-3 py-2 text-start text-dark"
            style={{ fontSize: '0.875rem', cursor: 'pointer' }}
            onClick={handleLogout}
          >
            <FaSignOutAlt />
            <span>{t('auth.logout')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

interface NavbarProps {
  /** Called after the tap sequence completes on the logo — a
   * touch-friendly stand-in for the keyboard-only useDosCode trigger,
   * on devices with no physical keyboard. Same useTapTrigger mechanism
   * the footer already uses for the retro theme's mobile trigger. */
  onLogoTapSequence?: () => void
}

const Navbar: React.FC<NavbarProps> = ({ onLogoTapSequence }) => {
  const { t } = useTranslation()
  const { user, checked } = useContext(AuthContext)
  const [isOpen, setIsOpen] = useState(false)
  const [partnerLogoUrl, setPartnerLogoUrl] = useState<string | null>(null)
  const registerLogoTap = useTapTrigger(() => onLogoTapSequence?.())

  useEffect(() => {
    systemApi.getTheme().then((res) => setPartnerLogoUrl(res.partner_logo_url)).catch(() => {})
  }, [])

  const toggleMenu = () => setIsOpen(!isOpen)
  const closeMenu = () => setIsOpen(false)

  const navItemsBefore = [
    { to: '/', icon: <FaThLarge className="nav-icon" />, label: t('nav.dashboard'), end: true },
  ]
  const navItemsAfter = [
    { to: '/playlists', icon: <FaListUl className="nav-icon" />, label: t('nav.playlists'), end: false },
    { to: '/scheduling', icon: <FaCalendarAlt className="nav-icon" />, label: t('nav.scheduling'), end: false },
    { to: '/content', icon: <FaPhotoVideo className="nav-icon" />, label: t('nav.content'), end: true },
    { to: '/deploy/history', icon: <FaHistory className="nav-icon" />, label: t('nav.history'), end: false },
    { to: '/settings', icon: <FaCog className="nav-icon" />, label: t('nav.settings'), end: false },
  ]

  // Before login (or while the auth check hasn't resolved yet), show a bare
  // navbar — brand + language switcher only, no menu items and no user menu.
  const isAuthenticated = checked && !!user

  return (
      <nav className="fm-navbar">
        <div className="container-fluid d-flex align-items-center px-3 h-100">
          <NavLink to="/" className="navbar-brand" onClick={() => { closeMenu(); registerLogoTap() }}>
            <img src="/static/img/logo.svg" alt="MupiTech Fleet Manager" className="logo-default" />
            <img src="/static/img/logo-retro.svg" alt="MupiTech Fleet Manager" className="logo-retro" />
            <img src="/static/img/logo-dos.svg" alt="MupiTech Fleet Manager" className="logo-dos" />
          </NavLink>
          {partnerLogoUrl && (
            <span className="navbar-partner-logo">
              <span className="navbar-partner-logo__divider" aria-hidden="true" />
              <img src={partnerLogoUrl} alt="" />
            </span>
          )}

          {isAuthenticated && (
            <button
              className="btn-navbar d-lg-none ms-auto me-2"
              onClick={toggleMenu}
              aria-label="Toggle navigation"
            >
              {isOpen ? <FaTimes /> : <FaBars />}
            </button>
          )}

          {isAuthenticated && (
            <div className={`flex-grow-1 d-lg-flex align-items-center justify-content-center ${isOpen ? 'd-flex flex-column flex-lg-row position-absolute start-0 end-0 bg-purple-dark p-3 p-lg-0' : 'd-none'}`}
              style={isOpen ? { top: '85px', zIndex: 1030, backgroundColor: '#04182B' } : {}}>
              <ul className="navbar-nav d-flex flex-column flex-lg-row list-unstyled mb-0 gap-1">
                {navItemsBefore.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'active' : ''}`
                      }
                      onClick={closeMenu}
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  </li>
                ))}
                <FleetMenu onNavigate={closeMenu} />
                {navItemsAfter.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'active' : ''}`
                      }
                      onClick={closeMenu}
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={`navbar-actions d-none d-lg-flex align-items-center gap-2 ${isAuthenticated ? '' : 'ms-auto'}`}>
            <LanguageSwitcher />
            {isAuthenticated && <UserMenu />}
          </div>

          {isOpen && isAuthenticated && (
            <div className="d-lg-none position-absolute end-0 p-3 d-flex align-items-center gap-2" style={{ top: '85px', zIndex: 1031 }}>
              <LanguageSwitcher />
              <UserMenu />
            </div>
          )}
        </div>
      </nav>
  )
}

export default Navbar
