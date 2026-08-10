import React, { useEffect, useState, createContext } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Navbar from './navbar'
import Footer from './footer'
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

export type UserRole = 'viewer' | 'editor' | 'admin' | null

export const RoleContext = createContext<UserRole>(null)

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

const App: React.FC = () => {
  const { i18n } = useTranslation()
  const [user, setUser] = useState<User | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

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
          <Navbar />
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
          <Footer />
        </FeaturesProvider>
      </RoleContext.Provider>
    </AuthContext.Provider>
  )
}

export default App
