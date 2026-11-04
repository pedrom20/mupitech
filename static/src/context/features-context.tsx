import React, { createContext, useContext, useEffect, useState } from 'react'
import { system } from '@/services/api'

interface Features {
  cctv: boolean
  microsoft_login: boolean
}

const DEFAULT_FEATURES: Features = {
  cctv: false,
  microsoft_login: false,
}

const FeaturesContext = createContext<Features>(DEFAULT_FEATURES)

export const FeaturesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES)

  // AllowAny on the backend (fleet_manager/system_views.py::system_features)
  // specifically so this works pre-auth too — the login page needs
  // microsoftLogin before anyone's authenticated.
  useEffect(() => {
    system.getFeatures().then((res) => {
      setFeatures({ ...DEFAULT_FEATURES, ...res })
    }).catch(() => {})
  }, [])

  return (
    <FeaturesContext.Provider value={features}>
      {children}
    </FeaturesContext.Provider>
  )
}

export const useFeatures = (): Features => useContext(FeaturesContext)
