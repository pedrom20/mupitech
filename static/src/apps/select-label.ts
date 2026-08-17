// Adapted from mupitech-player's static/src/apps/select-label.ts — same
// logic, but takes `t` as a parameter instead of importing a module-
// level singleton, since react-i18next's `t` only exists inside a
// component via useTranslation().

import type { SettingSchema, SettingValue } from './types'

export function selectOptionLabel(
  schema: SettingSchema,
  value: SettingValue,
  t: (key: string, fallback: string) => string,
): string {
  const labels = schema['x-enumLabels'] || []
  const options = schema.enum ?? []
  const i = options.findIndex((v) => v === value)
  if (i >= 0 && labels[i] !== undefined) return labels[i]
  return value === '' ? t('apps.selectDefault', 'Default') : String(value)
}
