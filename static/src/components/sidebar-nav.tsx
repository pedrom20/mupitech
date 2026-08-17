import React, { useContext, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  FaThLarge, FaPhotoVideo, FaHistory, FaCog, FaDesktop, FaLayerGroup,
  FaMapMarkerAlt, FaListUl, FaSitemap, FaCalendarAlt, FaChevronLeft, FaChevronRight, FaChevronDown,
} from 'react-icons/fa'
import { SidebarNavContext } from '@/components/app'

const FLEET_EXPANDED_STORAGE_KEY = 'fm_sidebar_fleet_expanded'

/** Experimental alternative to the top navbar's menu — a left sidebar
 * with the same routes, collapsible down to an icon-only rail. Opt-in,
 * instance-wide (see SidebarNavContext in app.tsx); desktop-only by
 * design — on small screens the navbar's own mobile dropdown (still
 * intact, see navbar.tsx's hideDesktopNavItems prop) covers navigation
 * instead of duplicating it here. */
const SidebarNav: React.FC = () => {
  const { t } = useTranslation()
  const { collapsed, setCollapsed } = useContext(SidebarNavContext)
  // Independent from the whole-sidebar collapse above — this just
  // expands/collapses the "Fleet" group of links (an accordion), and
  // only makes sense while the sidebar itself has room for text: when
  // the whole sidebar is icon-only, every fleet icon always shows
  // regardless of this, same as before this existed.
  const [fleetExpanded, setFleetExpanded] = useState(
    () => localStorage.getItem(FLEET_EXPANDED_STORAGE_KEY) !== '0',
  )

  const toggleCollapsed = () => setCollapsed(!collapsed)
  const toggleFleetExpanded = () => {
    setFleetExpanded((prev) => {
      const next = !prev
      localStorage.setItem(FLEET_EXPANDED_STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  const topItems = [
    { to: '/', icon: FaThLarge, label: t('nav.dashboard'), end: true },
  ]
  const fleetItems = [
    { to: '/fleet', icon: FaSitemap, label: t('nav.fleetOverview'), end: false },
    { to: '/players', icon: FaDesktop, label: t('nav.players'), end: false },
    { to: '/groups', icon: FaLayerGroup, label: t('nav.groups'), end: false },
    { to: '/locations', icon: FaMapMarkerAlt, label: t('nav.locations'), end: false },
  ]
  const bottomItems = [
    { to: '/playlists', icon: FaListUl, label: t('nav.playlists'), end: false },
    { to: '/scheduling', icon: FaCalendarAlt, label: t('nav.scheduling'), end: false },
    { to: '/content', icon: FaPhotoVideo, label: t('nav.content'), end: true },
    { to: '/deploy/history', icon: FaHistory, label: t('nav.history'), end: false },
    { to: '/settings', icon: FaCog, label: t('nav.settings'), end: false },
  ]

  // Labels always render (never conditionally unmounted) — the
  // sidebar-collapsed state hides them with a CSS opacity/width
  // transition (see .fm-sidebar-label in _styles.scss) instead of a
  // hard cut, so collapsing/expanding reads as one smooth motion.
  const renderItem = ({ to, icon: Icon, label, end }: { to: string; icon: typeof FaThLarge; label: string; end: boolean }) => (
    <li key={to}>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) => `fm-sidebar-link ${isActive ? 'active' : ''}`}
        title={collapsed ? label : undefined}
      >
        <Icon className="fm-sidebar-icon" />
        <span className="fm-sidebar-label">{label}</span>
      </NavLink>
    </li>
  )

  return (
    <nav className={`fm-sidebar d-none d-lg-flex ${collapsed ? 'is-collapsed' : ''}`}>
      {/* Edge-pinned so it's always in the same, always-visible spot
          regardless of how long the nav list is or how far it's
          scrolled — a button at the bottom of a long list turned out
          to be easy to miss entirely. */}
      <button
        type="button"
        className="fm-sidebar-collapse-btn"
        onClick={toggleCollapsed}
        title={collapsed ? t('nav.sidebarExpand') : t('nav.sidebarCollapse')}
      >
        {collapsed ? <FaChevronRight /> : <FaChevronLeft />}
      </button>
      <ul className="list-unstyled mb-0 flex-grow-1">
        {topItems.map(renderItem)}
        {collapsed ? (
          fleetItems.map(renderItem)
        ) : (
          <>
            <li>
              <button
                type="button"
                className="fm-sidebar-section-toggle"
                onClick={toggleFleetExpanded}
                aria-expanded={fleetExpanded}
              >
                <span className="fm-sidebar-section-label">{t('nav.fleet')}</span>
                <FaChevronDown className={`fm-sidebar-section-chevron ${fleetExpanded ? '' : 'is-collapsed'}`} />
              </button>
            </li>
            {/* grid-template-rows 0fr↔1fr is what actually animates —
                a plain height:auto can't transition, and a fixed max-
                height either clips a taller list or leaves dead space
                on a shorter one. */}
            <li className={`fm-sidebar-accordion ${fleetExpanded ? 'is-expanded' : ''}`}>
              <ul className="list-unstyled mb-0">
                {fleetItems.map(renderItem)}
              </ul>
            </li>
          </>
        )}
        {!collapsed && <hr className="fm-sidebar-divider" />}
        {bottomItems.map(renderItem)}
      </ul>
    </nav>
  )
}

export default SidebarNav
