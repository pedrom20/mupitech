// Ported from mupitech-player's static/src/apps/types.ts — the Fleet
// Manager reads the exact same signage-app store index and per-app
// manifests as the device's own Add → Apps tab does, just from the
// operator's browser instead of the device's. Kept in lockstep with
// the device copy deliberately (not shared via a package) since the
// two repos build independently; diverge only if the store's contract
// itself changes.

export type SettingValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SettingValue[]
  | { [key: string]: SettingValue }

export type SettingValues = Record<string, SettingValue>

export interface SettingSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  format?: string
  minimum?: number
  maximum?: number
  properties?: Record<string, SettingSchema>
  items?: SettingSchema
  required?: string[]
  'x-widget'?: string
  'x-enumLabels'?: string[]
  'x-format'?: string
  'x-group'?: string
}

export interface ManifestSettings {
  type: 'object'
  properties: Record<string, SettingSchema>
}

export interface ManifestLaunch {
  baseUrl: string
  template?: string
}

export interface ManifestPlayback {
  pacing?: 'fixed' | 'stepped'
  loops?: boolean
  stepSeconds?: number
  refreshIntervalS?: number
}

export interface AppManifest {
  manifestVersion: string
  id: string
  name: string
  description: string
  summary?: string
  vendor?: string
  tags?: string[]
  icon?: string
  screenshots?: string[]
  homepage?: string
  source?: string
  support?: string
  playback?: ManifestPlayback
  settings?: ManifestSettings
  launch: ManifestLaunch
}

export interface IndexEntry {
  id: string
  manifest: string
}

export interface StoreIndex {
  indexVersion: string
  updated?: string
  apps: IndexEntry[]
}

export interface CatalogApp {
  id: string
  manifestUrl: string
  manifest: AppManifest
}
