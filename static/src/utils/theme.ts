export type ThemePreference = 'light' | 'dark' | 'system'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  }
  return pref
}

export function applyTheme(pref: ThemePreference) {
  document.documentElement.setAttribute('data-bs-theme', resolveTheme(pref))
}

/** Keeps the applied theme in sync with the OS setting while `pref` is
 * 'system' — e.g. the OS switches to dark mode at sunset while the app
 * is already open in a tab. No-op (and no listener attached) otherwise. */
export function watchSystemTheme(pref: ThemePreference, onChange: () => void): () => void {
  if (pref !== 'system') return () => {}
  const mql = window.matchMedia(DARK_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
