// Ported verbatim (pure function, no DOM) from mupitech-player's
// static/src/apps/launch-url.ts — builds a signage-app launch URL from
// its manifest's `launch.template` (an RFC 6570 URI Template) and the
// current setting values, matching exactly what the device's own Add →
// Apps tab (and the app store itself) would build for identical values.
//
// Only meaningful values reach the URL: undefined/empty/false/equal-to-
// default is omitted, so the URL stays at the app's defaults until the
// operator actually changes something. A trailing `*` on a template var
// explodes an array (repeated `name=` params) or object (its own
// `key=value` pairs).

import type { SettingValue, SettingValues } from './types'

export type { SettingValue, SettingValues }

const encodeToken = (value: string): string =>
  encodeURIComponent(value).replace(/%2F/g, '/').replace(/%7C/g, '|')

function isEmpty(value: SettingValue, def: SettingValue): boolean {
  if (value === undefined || value === null || value === '' || value === false) {
    return true
  }
  return def !== undefined && value === def
}

function expandVar(spec: string, values: SettingValues, defaults: SettingValues): string[] {
  const explode = spec.endsWith('*')
  const name = explode ? spec.slice(0, -1) : spec
  const value = values[name]

  if (explode) {
    const def = defaults[name]
    if (def !== undefined && JSON.stringify(value) === JSON.stringify(def)) {
      return []
    }
    if (Array.isArray(value)) {
      return value
        .filter((v) => v !== undefined && v !== null && v !== '')
        .map((v) => `${name}=${encodeToken(String(v))}`)
    }
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeToken(k)}=${encodeToken(String(v))}`)
    }
    return []
  }

  if (isEmpty(value, defaults[name])) return []
  return [`${name}=${encodeToken(value === true ? '1' : String(value))}`]
}

export function buildLaunchUrl(
  baseUrl: string,
  template: string,
  values: SettingValues = {},
  defaults: SettingValues = {},
): string {
  if (!template) return baseUrl
  const match = template.match(/\{\?([^}]*)\}/)
  if (!match) return baseUrl

  const parts: string[] = []
  for (const spec of match[1].split(',').map((s) => s.trim()).filter(Boolean)) {
    parts.push(...expandVar(spec, values, defaults))
  }
  return parts.length ? `${baseUrl}?${parts.join('&')}` : baseUrl
}
