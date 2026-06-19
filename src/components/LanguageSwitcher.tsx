/**
 * Language Switcher Component
 * Allows users to switch between supported mobile app languages
 */

import { useState, useEffect } from 'react'
import { getCurrentLanguage, setLanguage, type Language } from '../services/i18n'
import './LanguageSwitcher.css'

export default function LanguageSwitcher() {
  const [currentLang, setCurrentLang] = useState<Language>(getCurrentLanguage())

  useEffect(() => {
    const handleLanguageChange = (e: Event) => {
      const customEvent = e as CustomEvent<Language>
      setCurrentLang(customEvent.detail)
    }

    window.addEventListener('languageChanged', handleLanguageChange)
    return () => window.removeEventListener('languageChanged', handleLanguageChange)
  }, [])

  const handleLanguageSelection = (lang: Language) => {
    setLanguage(lang)
    setCurrentLang(lang)
  }

  return (
    <div className="language-switcher">
      <button
        className={`lang-btn ${currentLang === 'en' ? 'active' : ''}`}
        onClick={() => handleLanguageSelection('en')}
        aria-label="Switch to English"
      >
        EN
      </button>
      <button
        className={`lang-btn ${currentLang === 'id' ? 'active' : ''}`}
        onClick={() => handleLanguageSelection('id')}
        aria-label="Switch to Bahasa Indonesia"
      >
        ID
      </button>
      <button
        className={`lang-btn ${currentLang === 'zh' ? 'active' : ''}`}
        onClick={() => handleLanguageSelection('zh')}
        aria-label="切换到中文"
      >
        中文
      </button>
    </div>
  )
}
