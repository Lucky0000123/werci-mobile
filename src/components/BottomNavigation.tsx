import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { JSX } from 'react'
import { useI18n } from '../services/i18n-context'

type IconProps = {
  active: boolean
}

interface NavItem {
  path: string
  activePaths: string[]
  label: string
  icon: (props: IconProps) => JSX.Element
}

const iconColor = (active: boolean) => (active ? '#2563EB' : '#94A3B8')

const HomeIcon = ({ active }: IconProps) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 10.5L12 3L21 10.5" stroke={iconColor(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 9.5V20H19V9.5" stroke={iconColor(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 20V14H14V20" stroke={iconColor(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ScanIcon = ({ active }: IconProps) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.5" y="6.5" width="17" height="13" rx="2.5" stroke={iconColor(active)} strokeWidth="2" />
    <circle cx="12" cy="13" r="3.5" stroke={iconColor(active)} strokeWidth="2" />
    <path d="M8 6.5L9.5 4.5H14.5L16 6.5" stroke={iconColor(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const HistoryIcon = ({ active }: IconProps) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" stroke={iconColor(active)} strokeWidth="2" />
    <path d="M8.5 8H15.5" stroke={iconColor(active)} strokeWidth="2" strokeLinecap="round" />
    <path d="M8.5 12H15.5" stroke={iconColor(active)} strokeWidth="2" strokeLinecap="round" />
    <path d="M8.5 16H13" stroke={iconColor(active)} strokeWidth="2" strokeLinecap="round" />
  </svg>
)

const DispatchIcon = ({ active }: IconProps) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 7.5H13V16H3V7.5Z" stroke={iconColor(active)} strokeWidth="2" strokeLinejoin="round" />
    <path d="M13 10.5H17.5L20.5 13.5V16H13V10.5Z" stroke={iconColor(active)} strokeWidth="2" strokeLinejoin="round" />
    <circle cx="6.5" cy="17.5" r="1.8" stroke={iconColor(active)} strokeWidth="2" />
    <circle cx="16.5" cy="17.5" r="1.8" stroke={iconColor(active)} strokeWidth="2" />
  </svg>
)

const SettingsIcon = ({ active }: IconProps) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="3.25" stroke={iconColor(active)} strokeWidth="2" />
    <path
      d="M19.3 15.4L20.3 17.1L18.4 19L16.7 18C16.2 18.3 15.7 18.6 15.1 18.7L14.6 20.6H11.9L11.4 18.7C10.8 18.6 10.3 18.3 9.8 18L8.1 19L6.2 17.1L7.2 15.4C6.9 14.9 6.6 14.4 6.5 13.8L4.6 13.3V10.6L6.5 10.1C6.6 9.5 6.9 9 7.2 8.5L6.2 6.8L8.1 4.9L9.8 5.9C10.3 5.6 10.8 5.3 11.4 5.2L11.9 3.3H14.6L15.1 5.2C15.7 5.3 16.2 5.6 16.7 5.9L18.4 4.9L20.3 6.8L19.3 8.5C19.6 9 19.9 9.5 20 10.1L21.9 10.6V13.3L20 13.8C19.9 14.4 19.6 14.9 19.3 15.4Z"
      stroke={iconColor(active)}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export default function BottomNavigation() {
  const location = useLocation()
  const { t } = useI18n()

  // Employee lookup lives on the dashboard (Home) now — no separate tab.
  const navItems: NavItem[] = [
    { path: '/home', activePaths: ['/home', '/'], label: t('home'), icon: HomeIcon },
    { path: '/scan', activePaths: ['/scan'], label: t('scan'), icon: ScanIcon },
    { path: '/dispatch', activePaths: ['/dispatch'], label: 'Dispatch', icon: DispatchIcon },
    { path: '/history', activePaths: ['/history'], label: t('history'), icon: HistoryIcon },
    { path: '/settings', activePaths: ['/settings'], label: t('settings'), icon: SettingsIcon }
  ]

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1030,
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid #E5E7EB',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        boxShadow: '0 -14px 30px rgba(15, 23, 42, 0.10)'
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          alignItems: 'stretch',
          gap: '6px',
          maxWidth: '720px',
          margin: '0 auto',
          padding: '8px 10px 0'
        }}
      >
        {navItems.map((item) => {
          const isActive = item.activePaths.includes(location.pathname)
          const Icon = item.icon

          return (
            <motion.div
              key={item.path}
              whileTap={{ scale: 0.90 }}
              whileHover={{ scale: 1.04 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            >
              <NavLink
                to={item.path}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  minWidth: 0,
                  minHeight: '62px',
                  padding: '8px 4px',
                  textDecoration: 'none',
                  color: isActive ? '#1E3A8A' : '#64748B',
                  borderRadius: '16px',
                  background: isActive ? 'linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 100%)' : 'transparent',
                  border: isActive ? '1px solid #BFDBFE' : '1px solid transparent',
                  transition: 'all 0.2s ease'
                }}
              >
                <Icon active={isActive} />
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: isActive ? 700 : 500,
                    letterSpacing: '0.01em',
                    lineHeight: 1.15,
                    textAlign: 'center',
                    whiteSpace: 'normal'
                  }}
                >
                  {item.label}
                </span>
              </NavLink>
            </motion.div>
          )
        })}
      </div>
    </nav>
  )
}
