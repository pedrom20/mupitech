import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaAppStore, FaArrowLeft, FaCheck, FaExclamationTriangle } from 'react-icons/fa'
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

/** Browse the same public signage-app store catalog mupitech-player's
 * own device-side Add → Apps tab reads (see static/src/apps/catalog.ts,
 * ported from there), configure an app, and install it as a normal
 * web-source content item — it rides the existing deploy pipeline from
 * there on, no device-side changes needed. */
const AppsTab: React.FC<AppsTabProps> = ({ onInstall }) => {
  const { t } = useTranslation()
  const [apps, setApps] = useState<CatalogApp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    setError('')
    loadCatalog(undefined, controller.signal)
      .then((result) => {
        setApps(result)
        if (result.length === 0) setError(t('apps.noAppsAvailable'))
      })
      .catch(() => setError(t('apps.storeUnreachable')))
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

  if (error && apps.length === 0) {
    return (
      <div className="text-center py-4 text-muted">
        <FaExclamationTriangle className="mb-2" size={24} />
        <p className="mb-0">{error}</p>
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
              <span className="d-block fw-semibold" style={{ fontSize: '0.85rem' }}>{app.manifest.name}</span>
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
