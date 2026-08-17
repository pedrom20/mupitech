import React from 'react'
import { useTranslation } from 'react-i18next'
import { widgetFor } from '@/apps/widget-for'
import { selectOptionLabel } from '@/apps/select-label'
import type { AppManifest, SettingValue, SettingValues } from '@/apps/types'

interface AppSettingsFormProps {
  manifest: AppManifest
  values: SettingValues
  onChange: (values: SettingValues) => void
}

/** Renders a form from an app manifest's JSON-Schema-ish settings
 * (manifest.settings.properties), same contract mupitech-player's own
 * Add → Apps tab renders from (see static/src/apps/widget-for.ts,
 * ported alongside this). 'location-map' renders as plain lat/lng
 * number inputs here instead of the device's Leaflet map widget —
 * same values end up in the launch URL either way, just without
 * pulling a mapping library into the Fleet Manager for one widget
 * type. 'unsupported' (a generic object/array with no known shape)
 * is silently skipped, matching the device's own graceful degrade. */
const AppSettingsForm: React.FC<AppSettingsFormProps> = ({ manifest, values, onChange }) => {
  const { t } = useTranslation()
  const properties = manifest.settings?.properties ?? {}

  const setField = (key: string, value: SettingValue) => {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="d-flex flex-column gap-3">
      {Object.entries(properties).map(([key, schema]) => {
        const widget = widgetFor(schema)
        if (widget === 'unsupported') return null

        const value = key in values ? values[key] : (schema.default as SettingValue)
        const label = schema.title || key
        const location = (value && typeof value === 'object' ? value : {}) as { lat?: number; lng?: number }

        return (
          <div key={key}>
            <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.82rem' }}>{label}</label>

            {widget === 'toggle' && (
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={Boolean(value)}
                  onChange={(e) => setField(key, e.target.checked)}
                />
              </div>
            )}

            {widget === 'select' && (
              <select
                className="form-select form-select-sm"
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(e) => setField(key, e.target.value)}
              >
                {(schema.enum ?? []).map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {selectOptionLabel(schema, opt as SettingValue, t)}
                  </option>
                ))}
              </select>
            )}

            {widget === 'number' && (
              <input
                type="number"
                className="form-control form-control-sm"
                value={value === undefined || value === null ? '' : Number(value)}
                min={schema.minimum}
                max={schema.maximum}
                onChange={(e) => setField(key, e.target.value === '' ? undefined : Number(e.target.value))}
              />
            )}

            {(widget === 'date' || widget === 'time' || widget === 'datetime') && (
              <input
                type={widget === 'datetime' ? 'datetime-local' : widget}
                className="form-control form-control-sm"
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(e) => setField(key, e.target.value)}
              />
            )}

            {widget === 'location-map' && (
              <div className="d-flex gap-2">
                <input
                  type="number"
                  step="any"
                  className="form-control form-control-sm"
                  placeholder="lat"
                  value={location.lat ?? ''}
                  onChange={(e) => setField(key, { ...location, lat: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
                <input
                  type="number"
                  step="any"
                  className="form-control form-control-sm"
                  placeholder="lng"
                  value={location.lng ?? ''}
                  onChange={(e) => setField(key, { ...location, lng: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
            )}

            {widget === 'text' && (
              <input
                type="text"
                className="form-control form-control-sm"
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(e) => setField(key, e.target.value)}
              />
            )}

            {schema.description && (
              <div className="form-text" style={{ fontSize: '0.72rem' }}>{schema.description}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default AppSettingsForm
