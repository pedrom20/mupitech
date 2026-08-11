import React, { useEffect, useState, useCallback, createContext } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Swal from 'sweetalert2'
import Navbar from './navbar'
import Footer from './footer'
import { useKonamiCode } from '@/hooks/use-konami-code'
import { useDosCode } from '@/hooks/use-dos-code'
import { usePageTitle } from '@/hooks/use-page-title'
import Dashboard from '@/components/dashboard/index'
import PlayerList from '@/components/players/player-list'
import PlayerDetail from '@/components/players/player-detail'
import GroupList from '@/components/groups/group-list'
import LocationList from '@/components/locations/location-list'
import PlaylistList from '@/components/playlists/playlist-list'
import ContentPage from '@/components/deploy/deploy-form'
import DeployHistory from '@/components/deploy/deploy-history'
import DeployProgress from '@/components/deploy/deploy-progress'
import Settings from '@/components/settings/settings'
import AuditLog from '@/components/settings/audit-log'
import Login from '@/components/auth/login'
import ChangelogPage from '@/components/changelog-page'
import { users as usersApi } from '@/services/api'
import { FeaturesProvider } from '@/context/features-context'
import type { User } from '@/types'

export type UserRole = 'viewer' | 'editor' | 'admin' | 'superadmin' | null

export const RoleContext = createContext<UserRole>(null)

/** Admin-gated UI should show for both admin and superadmin — superadmin
 * is a strict superset (full access, including a few superadmin-only
 * areas like Tailscale settings, gated separately with isSuperAdminRole). */
export const isAdminRole = (role: UserRole): boolean => role === 'admin' || role === 'superadmin'
export const isSuperAdminRole = (role: UserRole): boolean => role === 'superadmin'

interface AuthContextValue {
  user: User | null
  checked: boolean
  refresh: () => void
  clear: () => void
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  checked: false,
  refresh: () => {},
  clear: () => {},
})

const RETRO_STORAGE_KEY = 'fm_retro_theme'
const DOS_STORAGE_KEY = 'fm_dos_theme'

const App: React.FC = () => {
  const { i18n, t } = useTranslation()
  const [user, setUser] = useState<User | null>(null)
  const [checked, setChecked] = useState(false)
  const [retroTheme, setRetroTheme] = useState(() => localStorage.getItem(RETRO_STORAGE_KEY) === '1')
  const [dosTheme, setDosTheme] = useState(() => localStorage.getItem(DOS_STORAGE_KEY) === '1')

  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  useEffect(() => {
    if (retroTheme) {
      document.documentElement.setAttribute('data-retro-theme', 'true')
    } else {
      document.documentElement.removeAttribute('data-retro-theme')
    }
    localStorage.setItem(RETRO_STORAGE_KEY, retroTheme ? '1' : '0')
  }, [retroTheme])

  useEffect(() => {
    if (dosTheme) {
      document.documentElement.setAttribute('data-dos-theme', 'true')
    } else {
      document.documentElement.removeAttribute('data-dos-theme')
    }
    localStorage.setItem(DOS_STORAGE_KEY, dosTheme ? '1' : '0')
  }, [dosTheme])

  // The two easter-egg themes are mutually exclusive — activating one
  // turns the other off, since both are full-page reskins.
  const toggleRetroTheme = useCallback(() => {
    setRetroTheme((prev) => {
      const next = !prev
      if (next) setDosTheme(false)
      Swal.fire({
        icon: 'info',
        title: next ? t('easterEgg.activated') : t('easterEgg.deactivated'),
        timer: 2000,
        showConfirmButton: false,
      })
      return next
    })
  }, [t])

  const toggleDosTheme = useCallback(() => {
    setDosTheme((prev) => {
      const next = !prev
      if (next) setRetroTheme(false)
      Swal.fire({
        icon: 'info',
        title: next ? t('easterEgg.dosActivated') : t('easterEgg.dosDeactivated'),
        timer: 2000,
        showConfirmButton: false,
      })
      return next
    })
  }, [t])

  useKonamiCode(toggleRetroTheme)
  useDosCode(toggleDosTheme)
  usePageTitle()

  const refresh = () => {
    usersApi.me().then((u) => {
      setUser(u)
    }).catch(() => {
      setUser(null)
    }).finally(() => {
      setChecked(true)
    })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => setUser(null)

  return (
    <AuthContext.Provider value={{ user, checked, refresh, clear }}>
      <RoleContext.Provider value={user?.role ?? null}>
        <FeaturesProvider>
          <Navbar onLogoTapSequence={toggleDosTheme} />
          <main className="fm-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/players" element={<PlayerList />} />
              <Route path="/players/:id" element={<PlayerDetail />} />
              <Route path="/groups" element={<GroupList />} />
              <Route path="/locations" element={<LocationList />} />
              <Route path="/playlists" element={<PlaylistList />} />
              <Route path="/content" element={<ContentPage />} />
              <Route path="/deploy/history" element={<DeployHistory />} />
              <Route path="/deploy/:id" element={<DeployProgress />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/changelog" element={<ChangelogPage />} />
              <Route path="/login" element={<Login />} />
            </Routes>
          </main>
          <Footer onSecretTrigger={toggleRetroTheme} />
          {retroTheme && (
            <button
              type="button"
              className="fm-retro-badge"
              onClick={() => setRetroTheme(false)}
              title={t('easterEgg.exitHint')}
            >
              🗄️ {t('easterEgg.badge')}
            </button>
          )}
          {dosTheme && (
            <button
              type="button"
              className="fm-dos-badge"
              onClick={() => setDosTheme(false)}
              title={t('easterEgg.exitHint')}
            >
              C:\&gt; {t('easterEgg.dosBadge')}_
            </button>
          )}
        </FeaturesProvider>
      </RoleContext.Provider>
    </AuthContext.Provider>
  )
}

export default App
