/**
 * S-12 (FR-046): follow the system, or force dark or light.
 *
 * The preference is the only thing the app stores for itself, and it is not a secret: one of three
 * words. Anything else read back — an older build's value, a hand-edited one — means "system",
 * the default, rather than an error.
 */

export type ThemePreference = 'system' | 'dark' | 'light'
export type Theme = 'dark' | 'light'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light']

export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === 'dark' || raw === 'light' ? raw : 'system'
}

/** The theme actually rendered. */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference !== 'system') return preference
  return systemPrefersLight ? 'light' : 'dark'
}

/**
 * The browser chrome's colour per theme — the `--surface` of each palette in `index.css`, which
 * `index.html`'s two `theme-color` tags also carry. Kept in step with both by hand.
 */
export const THEME_COLOR: Record<Theme, string> = {
  dark: '#0b1117',
  light: '#ffffff',
}
