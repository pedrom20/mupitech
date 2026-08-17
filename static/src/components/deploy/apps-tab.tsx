import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaAppStore, FaArrowLeft, FaCheck } from 'react-icons/fa'
import { loadCatalog } from '@/apps/catalog'
import { buildLaunchUrl } from '@/apps/launch-url'
import { suggestedName } from '@/apps/suggested-name'
import type { CatalogApp, SettingValue, SettingValues } from '@/apps/types'
import AppSettingsForm from './app-settings-form'

interface AppsTabProps {
  /** Same contract as AddContentModal's onAddUrl — installing an app IS
   * just adding a web-source content item at the URL the app's manifest
   * builds from the chosen settings (see mupitech-player's own Add →
   * Apps tab, which does the identical thing for a device asset). */
  onInstall: (url: string, name: string) => Promise<void>
}

const defaultValues = (app: CatalogApp): SettingValues => {
  const values: SettingValues = {}
  for (const [key, schema] of Object.entries(app.manifest.settings?.properties ?? {})) {
    if (schema.default !== undefined) values[key] = schema.default as SettingValue
  }
  return values
}

const WEATHER_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="24" cy="22" r="13" fill="%23FFB020"/>' +
      '<path d="M14 46c-6 0-11-5-11-11 0-5.5 4.2-10 9.6-10.9C14.3 17.8 20.5 13 28 13c8.3 0 15 6.4 15.7 14.5C49 28.6 53 33.4 53 39c0 6.1-4.9 11-11 11H14z" fill="%23fff"/>' +
      '</svg>',
  )

/** Built in-app (no manifest fetch, no external launch host) rather
 * than pulled from signage-apps.com — see fleet_manager/weather_view.py.
 * Presented in the same picker/settings-form flow as the external
 * catalog so installing it is identical from the operator's side. */
const firstPartyApps = (t: (key: string, fallback: string) => string): CatalogApp[] => [
  {
    id: 'mupitech-weather',
    manifestUrl: '',
    manifest: {
      manifestVersion: '1.0',
      id: 'mupitech-weather',
      name: t('apps.weatherName', 'Weather'),
      description: t('apps.weatherDescription', 'Animated weather widget with the current conditions and forecast for a place of your choosing.'),
      summary: t('apps.weatherSummary', 'Current conditions, fully translated, no external service'),
      vendor: 'MupiTech',
      icon: WEATHER_ICON,
      settings: {
        type: 'object',
        properties: {
          location: {
            type: 'object',
            title: t('apps.weatherLocationLabel', 'Location'),
            properties: { lat: { type: 'number' }, lng: { type: 'number' } },
            default: { lat: 38.7223, lng: -9.1393 },
          },
          place: {
            type: 'string',
            title: t('apps.weatherPlaceLabel', 'Place name (shown on screen)'),
            default: 'Lisboa',
          },
        },
      },
      launch: {
        baseUrl: `${window.location.origin}/tools/weather/`,
        template: '{?location*,place}',
      },
    },
  },
]

/** Browse the same public signage-app store catalog mupitech-player's
 * own device-side Add → Apps tab reads (see static/src/apps/catalog.ts,
 * ported from there), configure an app, and install it as a normal
 * web-source content item — it rides the existing deploy pipeline from
 * there on, no device-side changes needed. */
const AppsTab: React.FC<AppsTabProps> = ({ onInstall }) => {
  const { t } = useTranslation()
  const [apps, setApps] = useState<CatalogApp[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CatalogApp | null>(null)
  const [values, setValues] = useState<SettingValues>({})
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [installing, setInstalling] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    loadCatalog(undefined, controller.signal)
      .then((result) => {
        setApps([...firstPartyApps(t), ...result])
      })
      .catch(() => {
        // Store unreachable is not fatal — the first-party apps still work.
        setApps(firstPartyApps(t))
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [t])

  const handleSelect = (app: CatalogApp) => {
    setSelected(app)
    const initial = defaultValues(app)
    setValues(initial)
    setName(suggestedName(app.manifest, initial, t))
    setNameEdited(false)
  }

  const handleValuesChange = (next: SettingValues) => {
    setValues(next)
    if (!nameEdited && selected) setName(suggestedName(selected.manifest, next, t))
  }

  const handleBack = () => {
    setSelected(null)
    setValues({})
    setName('')
    setNameEdited(false)
  }

  const handleInstall = async () => {
    if (!selected) return
    const url = buildLaunchUrl(
      selected.manifest.launch.baseUrl,
      selected.manifest.launch.template || '',
      values,
      defaultValues(selected),
    )
    setInstalling(true)
    try {
      await onInstall(url, name)
    } finally {
      setInstalling(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-4">
        <div className="spinner-border spinner-border-sm me-2" />
        {t('apps.loadingApps', 'Loading apps…')}
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="d-flex flex-wrap gap-2">
        {apps.map((app) => (
          <button
            key={app.id}
            type="button"
            className="btn btn-outline-secondary text-start d-flex align-items-center gap-2"
            style={{ width: '100%', maxWidth: '100%' }}
            onClick={() => handleSelect(app)}
          >
            {app.manifest.icon ? (
              <img src={app.manifest.icon} alt="" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
            ) : (
              <FaAppStore style={{ width: 28, height: 28, flexShrink: 0 }} />
            )}
            <span className="flex-grow-1" style={{ minWidth: 0 }}>
              <span className="d-block fw-semibold" style={{ fontSize: '0.85rem' }}>
                {app.manifest.name}
                {app.manifest.vendor === 'MupiTech' && (
                  <span className="badge bg-primary-subtle text-primary-emphasis ms-2" style={{ fontSize: '0.65rem' }}>
                    {t('apps.firstPartyBadge')}
                  </span>
                )}
              </span>
              <span className="d-block text-muted text-truncate" style={{ fontSize: '0.75rem' }}>
                {app.manifest.summary || app.manifest.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      <button type="button" className="btn btn-link btn-sm p-0 mb-3 text-decoration-none" onClick={handleBack}>
        <FaArrowLeft className="me-1" />
        {t('common.back')}
      </button>

      <div className="d-flex align-items-center gap-2 mb-3">
        {selected.manifest.icon && (
          <img src={selected.manifest.icon} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
        )}
        <div>
          <div className="fw-semibold">{selected.manifest.name}</div>
          <div className="text-muted" style={{ fontSize: '0.78rem' }}>{selected.manifest.description}</div>
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label fw-semibold" style={{ fontSize: '0.82rem' }}>{t('content.nameLabel')}</label>
        <input
          type="text"
          className="form-control form-control-sm"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameEdited(true) }}
        />
      </div>

      {selected.manifest.settings && (
        <AppSettingsForm manifest={selected.manifest} values={values} onChange={handleValuesChange} />
      )}

      <button
        type="button"
        className="fm-btn-primary w-100 mt-3"
        disabled={installing || !name}
        onClick={handleInstall}
      >
        <FaCheck />
        {installing ? t('common.loading') : t('content.addApp', 'Add app')}
      </button>
    </div>
  )
}

export default AppsTab
