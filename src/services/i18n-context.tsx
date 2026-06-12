/**
 * React Context for i18n to enable reactive language switching
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { translations, type Language } from './i18n'

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: keyof typeof translations.en) => string
}

const I18nContext = createContext<I18nContextType>({
  language: 'id',
  setLanguage: () => {},
  t: (key) => translations.en[key] || (key as string)
})

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(() => {
    const stored = localStorage.getItem('wbnkis_language')
    return (stored === 'en' || stored === 'es' || stored === 'id' || stored === 'zh') ? stored : 'id'
  })

  const setLanguage = useCallback((lang: Language) => {
    localStorage.setItem('wbnkis_language', lang)
    setLang(lang)
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: lang }))
  }, [])

  const t = useCallback((key: keyof typeof translations.en): string => {
    return translations[language][key] || translations.en[key] || key
  }, [language])

  // Listen for language changes from other tabs/components
  useEffect(() => {
    const handleChange = (e: Event) => {
      const customEvent = e as CustomEvent<Language>
      if (customEvent.detail && customEvent.detail !== language) {
        setLang(customEvent.detail)
      }
    }
    window.addEventListener('languageChanged', handleChange)
    return () => window.removeEventListener('languageChanged', handleChange)
  }, [language])

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  return useContext(I18nContext)
}

// eslint-disable-next-line react-refresh/only-export-components
export { type Language, translations }
