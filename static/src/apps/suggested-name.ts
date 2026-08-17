// Adapted from mupitech-player's static/src/apps/suggested-name.ts —
// derives a distinguishing default content name from an app's config
// (e.g. an RSS Reader install is named after the feed the operator
// picked, not just "RSS Reader" for every install). See select-label.ts
// for why `t` is threaded through as a parameter here.

import { selectOptionLabel } from './select-label'
import type { AppManifest, SettingValue } from './types'

export function suggestedName(
  manifest: AppManifest,
  values: Record<string, SettingValue>,
  t: (key: string, fallback: string) => string,
): string {
  const props = manifest.settings?.properties ?? {}
  for (const [key, schema] of Object.entries(props)) {
    const options = schema.enum
    if (!schema['x-enumLabels'] || !options) continue
    const value = key in values ? values[key] : (schema.default as SettingValue)
    if (!options.includes(value)) continue
    const label = selectOptionLabel(schema, value, t)
    if (label) return label
  }
  return manifest.name
}
