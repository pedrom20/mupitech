import { FaShieldAlt, FaMobileAlt, FaKey, FaBell, FaEnvelope } from 'react-icons/fa'
import type { IconType } from 'react-icons'
import type { MFAMethod } from '@/types'

// One icon per provider, shared by every surface that lists MFA
// methods (login.tsx's method switcher, security-settings.tsx's
// self-service cards, mfa-provider-settings.tsx's admin config cards)
// so the same method always reads as the same icon everywhere. None
// of these are the providers' own brand marks — Duo/AuthPoint aren't
// in react-icons' simple-icons set, and privacyIDEA's there is for a
// different "privacy" project entirely — so this picks a generic icon
// that fits each method's own mechanism (an authenticator code, a
// phone push, a key, a bell) instead.
export const MFA_METHOD_ICON: Record<MFAMethod, IconType> = {
  totp: FaShieldAlt,
  duo: FaMobileAlt,
  privacyidea: FaKey,
  authpoint: FaBell,
  email: FaEnvelope,
}
