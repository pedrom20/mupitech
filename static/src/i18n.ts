import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import pt from '@/locales/pt.json'
import en from '@/locales/en.json'

// uk/fr/de/pl translations still exist under @/locales for a possible future
// re-enable, but aren't loaded or selectable — pt is primary, en the only
// secondary option for now.
const resources = {
  pt: { translation: pt },
  en: { translation: en },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'pt',
    supportedLngs: ['pt', 'en'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['cookie', 'localStorage', 'navigator'],
      caches: ['cookie', 'localStorage'],
      lookupCookie: 'django_language',
      lookupLocalStorage: 'i18nextLng',
    },
  })

export default i18n
