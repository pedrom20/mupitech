import React, { useEffect, useState, useCallback, createContext } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Swal from 'sweetalert2'
import Navbar from './navbar'
import SidebarNav from './sidebar-nav'
import Footer from './footer'
import { useKonamiCode } from '@/hooks/use-konami-code'
import { useDosCode } from '@/hooks/use-dos-code'
import { useHackedCode } from '@/hooks/use-hacked-code'
import { usePageTitle } from '@/hooks/use-page-title'
import DosBootOverlay from '@/components/dos-boot-overlay'
import HackedOverlay from '@/components/hacked-overlay'
import Dashboard from '@/components/dashboard/index'
import PlayerList from '@/components/players/player-list'
import PlayerDetail from '@/components/players/player-detail'
import FleetOverview from '@/components/fleet-overview/fleet-overview'
import GroupList from '@/components/groups/group-list'
import LocationList from '@/components/locations/location-list'
import PlaylistList from '@/components/playlists/playlist-list'
import SchedulingPage from '@/components/scheduling/schedule-list'
import ContentPage from '@/components/deploy/deploy-form'
import DeployHistory from '@/components/deploy/deploy-history'
import DeployProgress from '@/components/deploy/deploy-progress'
import Settings from '@/components/settings/settings'
import AuditLog from '@/components/settings/audit-log'
import AccountPage from '@/components/account/account-page'
import OnboardingWizard from '@/components/onboarding/onboarding-wizard'
import SetupWizard from '@/components/setup/setup-wizard'
import Login from '@/components/auth/login'
import ResetPassword from '@/components/auth/reset-password'
import ChangelogPage from '@/components/changelog-page'
import { users as usersApi, system as systemApi } from '@/services/api'
import { FeaturesProvider } from '@/context/features-context'
import { applyTheme, watchSystemTheme, type ThemePreference } from '@/utils/theme'
import type { User, EditorCapabilities } from '@/types'

export type UserRole = 'viewer' | 'editor_simplificado' | 'editor' | 'admin' | 'superadmin' | null

export const RoleContext = createContext<UserRole>(null)

/** Admin-gated UI should show for both admin and superadmin — superadmin
 * is a strict superset (full access, including a few superadmin-only
 * areas like Tailscale settings, gated separately with isSuperAdminRole). */
export const isAdminRole = (role: UserRole): boolean => role === 'admin' || role === 'superadmin'
export const isSuperAdminRole = (role: UserRole): boolean => role === 'superadmin'

/** editor_simplificado is a restricted variant of editor (see
 * playlists/serializers.py on the backend) — same role for every
 * purpose except the one specific "can this user change which devices
 * a playlist targets" check (canEditPlaylistTargets below). Everywhere
 * else that used to check role === 'editor' should check this instead. */
export const isEditorRole = (role: UserRole): boolean => role === 'editor' || role === 'editor_simplificado'

/** Whether the current user can perform a given device-management
 * capability group (see players/editor_capabilities.py on the backend —
 * this must mirror that gate, since it's UI-only convenience, not a
 * security boundary). Admin/superadmin always can; an editor (either
 * variant) only if their editor_capabilities (from AuthContext's user,
 * refreshed from /api/users/me/) has that group turned on. Content
 * actions (asset assign/update/remove, clone content) aren't gated
 * here — editors always have those, same as the backend's
 * _CONTENT_ACTIONS. */
export const canEditorManage = (
  role: UserRole,
  capabilities: Partial<EditorCapabilities> | undefined,
  capability: keyof EditorCapabilities,
): boolean => {
  if (isAdminRole(role)) return true
  return isEditorRole(role) && !!capabilities?.[capability]
}

/** Whether the current user can change which devices/groups/locations
 * a playlist targets — the one place editor_simplificado differs from
 * a plain editor. See PlaylistSerializer.validate() on the backend. */
export const canEditPlaylistTargets = (role: UserRole): boolean =>
  isAdminRole(role) || role === 'editor'

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

interface ThemeContextValue {
  pref: ThemePreference
  setPref: (pref: ThemePreference) => void
  retro: boolean
  dos: boolean
}

export const ThemeContext = createContext<ThemeContextValue>({
  pref: 'light',
  setPref: () => {},
  retro: false,
  dos: false,
})

interface SidebarNavContextValue {
  /** Instance-wide, superadmin-controlled (system:experimental_sidebar_nav
   * on the backend) — NOT a personal preference, so this is fetched once
   * in app.tsx rather than read from localStorage. Exposed as context
   * (not just a prop) so settings.tsx's toggle can flip it live for
   * every open tab of every user, without a full page reload. */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  /** Collapsed-to-icon-rail state IS a personal preference (persisted
   * to localStorage in app.tsx) — owned here instead of inside
   * sidebar-nav.tsx itself because .fm-content's own margin-left needs
   * to match it too, and the two aren't parent/child in the DOM. */
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

export const SidebarNavContext = createContext<SidebarNavContextValue>({
  enabled: false,
  setEnabled: () => {},
  collapsed: false,
  setCollapsed: () => {},
})

const RETRO_STORAGE_KEY = 'fm_retro_theme'
const DOS_STORAGE_KEY = 'fm_dos_theme'
const THEME_STORAGE_KEY = 'fm_theme'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'fm_sidebar_nav_collapsed'

const App: React.FC = () => {
  const { i18n, t } = useTranslation()
  const [user, setUser] = useState<User | null>(null)
  const [checked, setChecked] = useState(false)
  const [retroTheme, setRetroTheme] = useState(() => localStorage.getItem(RETRO_STORAGE_KEY) === '1')
  const [dosTheme, setDosTheme] = useState(() => localStorage.getItem(DOS_STORAGE_KEY) === '1')
  // Plays the typing boot banner whenever the DOS theme is (re)activated —
  // both on toggle and on a fresh page load while it was already on.
  const [showDosBoot, setShowDosBoot] = useState(() => localStorage.getItem(DOS_STORAGE_KEY) === '1')
  const [showHacked, setShowHacked] = useState(false)
  const [themePref, setThemePref] = useState<ThemePreference>(
    () => (localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference) || 'light',
  )

  // Owned here (not in Settings) so the saved/system theme applies on
  // every page load, not only once the user has visited Settings.
  useEffect(() => {
    applyTheme(themePref)
    localStorage.setItem(THEME_STORAGE_KEY, themePref)
    return watchSystemTheme(themePref, () => applyTheme(themePref))
  }, [themePref])

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
      if (next) {
        setRetroTheme(false)
        setShowDosBoot(true)
      }
      Swal.fire({
        icon: 'info',
        title: next ? t('easterEgg.dosActivated') : t('easterEgg.dosDeactivated'),
        timer: 2000,
        showConfirmButton: false,
      })
      return next
    })
  }, [t])

  const triggerHacked = useCallback(() => {
    setShowHacked(true)
  }, [])

  useKonamiCode(toggleRetroTheme)
  useDosCode(toggleDosTheme)
  useHackedCode(triggerHacked)
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

  // null = not checked yet. Fetched alongside the normal auth check
  // (not gated behind "only if !user", since a fresh install has no
  // user *and* setup is required — both need to resolve up front to
  // pick the right thing to render) — see setup-wizard.tsx.
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [sidebarNavEnabled, setSidebarNavEnabled] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1',
  )

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    // Mirrors the exact condition SidebarNav/.fm-content--with-sidebar
    // render under — the shorter navbar-height-sidebar CSS (see
    // _variables.scss) only applies while this class is present, so
    // body's own padding-top (which nothing else in this component
    // tree controls) shrinks to match.
    document.body.classList.toggle(
      'fm-sidebar-mode', checked && !!user && sidebarNavEnabled,
    )
    return () => document.body.classList.remove('fm-sidebar-mode')
  }, [checked, user, sidebarNavEnabled])

  useEffect(() => {
    refresh()
    systemApi.getSetupRequired()
      .then((res) => setSetupRequired(res.required))
      .catch(() => setSetupRequired(false))
    systemApi.getSettings()
      .then((res) => setSidebarNavEnabled(res.experimental_sidebar_nav))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => setUser(null)

  return (
    <AuthContext.Provider value={{ user, checked, refresh, clear }}>
      <RoleContext.Provider value={user?.role ?? null}>
        <ThemeContext.Provider value={{ pref: themePref, setPref: setThemePref, retro: retroTheme, dos: dosTheme }}>
        <SidebarNavContext.Provider value={{
          enabled: sidebarNavEnabled, setEnabled: setSidebarNavEnabled,
          collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed,
        }}>
        <FeaturesProvider>
          {dosTheme && showDosBoot && (
            <DosBootOverlay onDone={() => setShowDosBoot(false)} />
          )}
          {showHacked && (
            <HackedOverlay onDone={() => setShowHacked(false)} />
          )}
          <Navbar onLogoTapSequence={toggleDosTheme} hideDesktopNavItems={sidebarNavEnabled} />
          {checked && user && sidebarNavEnabled && <SidebarNav />}
          <main className={`fm-content ${checked && user && sidebarNavEnabled ? `fm-content--with-sidebar ${sidebarCollapsed ? 'fm-content--sidebar-collapsed' : ''}` : ''}`}>
            {checked && !user && setupRequired ? (
              <SetupWizard onComplete={() => { setSetupRequired(false); refresh() }} />
            ) : user && (user.must_change_password || user.force_mfa_enroll) ? (
              <OnboardingWizard />
            ) : (
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/fleet" element={<FleetOverview />} />
                <Route path="/players" element={<PlayerList />} />
                <Route path="/players/:id" element={<PlayerDetail />} />
                <Route path="/groups" element={<GroupList />} />
                <Route path="/locations" element={<LocationList />} />
                <Route path="/playlists" element={<PlaylistList />} />
                <Route path="/scheduling" element={<SchedulingPage />} />
                <Route path="/content" element={<ContentPage />} />
                <Route path="/deploy/history" element={<DeployHistory />} />
                <Route path="/deploy/:id" element={<DeployProgress />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/audit" element={<AuditLog />} />
                <Route path="/changelog" element={<ChangelogPage />} />
                <Route path="/login" element={<Login />} />
                <Route path="/reset-password" element={<ResetPassword />} />
              </Routes>
            )}
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
        </SidebarNavContext.Provider>
        </ThemeContext.Provider>
      </RoleContext.Provider>
    </AuthContext.Provider>
  )
}

export default App
