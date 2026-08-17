// Ported verbatim from mupitech-player's static/src/apps/widget-for.ts
// — maps a setting's JSON Schema to the widget key the form renderer
// uses. The FM's own renderer (content/app-settings-form.tsx) handles
// 'location-map' as a plain lat/lng number-input pair rather than the
// device's Leaflet map widget — same values in the launch URL, just a
// simpler control, so this mapping itself doesn't need to change.

import type { SettingSchema } from './types'

const FORMAT_WIDGET: Record<string, string> = {
  'date-time': 'datetime',
  date: 'date',
  time: 'time',
}

export function widgetFor(schema: SettingSchema): string {
  if (schema['x-widget']) return schema['x-widget']
  if (Array.isArray(schema.enum)) return 'select'
  if (schema.type === 'boolean') return 'toggle'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'object') {
    const props = schema.properties || {}
    return props.lat && props.lng ? 'location-map' : 'unsupported'
  }
  if (schema.type === 'array') return 'unsupported'
  if (schema.type === 'string' && schema.format) {
    const w = FORMAT_WIDGET[schema.format]
    if (w) return w
  }
  return 'text'
}
