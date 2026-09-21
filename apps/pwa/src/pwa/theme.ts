import { useCallback, useState } from 'react'
import { THEME_COLOR, type ThemePreference, parseThemePreference } from '../domain/theme.ts'

/**
 * S-12 (FR-046), the browser half: where the preference is kept and how it reaches the page.
 *
 * Kept in `localStorage` — one word, no secret (CLAUDE.md rule 6), and sign-out clears it with
 * everything else. Applied as `data-theme` on <html>, which `index.css` reads; "system" removes
 * the attribute so the media query decides again. Applied from `main.tsx` before the first
 * render, so a forced theme does not flash the system's first.
 */

export const THEME_STORAGE_KEY = 'cezar-mobile.theme'

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    // Storage can refuse (a private window, a full quota): the system decides.
    return 'system'
  }
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference

  // The status bar. `index.html` carries one `theme-color` per scheme, keyed by media query; a
  // forced theme points both at its own colour, and "system" puts each back to its scheme's.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = /light/.test(meta.media) ? 'light' : 'dark'
    meta.content = THEME_COLOR[preference === 'system' ? scheme : preference]
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not kept past this launch; the choice still applies now.
  }
  applyTheme(preference)
}

/** The Settings control's state: the stored choice, and a setter that applies and keeps it. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState(readThemePreference)
  const choose = useCallback((next: ThemePreference) => {
    saveThemePreference(next)
    setPreference(next)
  }, [])
  return [preference, choose]
}
