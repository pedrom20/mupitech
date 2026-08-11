import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const ROUTE_TITLE_KEYS: [string, string][] = [
  ['/players/', 'nav.players'],
  ['/players', 'nav.players'],
  ['/groups', 'nav.groups'],
  ['/locations', 'nav.locations'],
  ['/playlists', 'nav.playlists'],
  ['/content', 'nav.content'],
  ['/deploy', 'nav.history'],
  ['/settings', 'nav.settings'],
  ['/audit', 'nav.audit'],
  ['/changelog', 'changelog.title'],
  ['/login', 'auth.login'],
]

/** Keeps the browser tab title in sync with the current page, instead of
 * a fixed "MupiTech Fleet Manager" everywhere — e.g. "Devices ·
 * MupiTech" or just "MupiTech" on the dashboard. */
export function usePageTitle() {
  const location = useLocation()
  const { t } = useTranslation()

  useEffect(() => {
    const match = ROUTE_TITLE_KEYS.find(([prefix]) => location.pathname.startsWith(prefix))
    document.title = match ? `${t(match[1])} · MupiTech` : 'MupiTech'
  }, [location.pathname, t])
}
