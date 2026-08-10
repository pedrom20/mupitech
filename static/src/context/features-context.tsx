import React, { createContext, useContext, useEffect, useState } from 'react'
import { system } from '@/services/api'
import { AuthContext } from '@/components/app'

interface Features {
  cctv: boolean
}

const DEFAULT_FEATURES: Features = {
  cctv: false,
}

const FeaturesContext = createContext<Features>(DEFAULT_FEATURES)

export const FeaturesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useContext(AuthContext)
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES)

  useEffect(() => {
    if (!user) return
    system.getFeatures().then((res) => {
      setFeatures({ ...DEFAULT_FEATURES, ...res })
    }).catch(() => {})
  }, [user])

  return (
    <FeaturesContext.Provider value={features}>
      {children}
    </FeaturesContext.Provider>
  )
}

export const useFeatures = (): Features => useContext(FeaturesContext)
