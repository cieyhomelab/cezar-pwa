import { THEME_PREFERENCES } from '../../domain/theme.ts'
import { en } from '../../i18n/en.ts'
import { useThemePreference } from '../../pwa/theme.ts'

/**
 * FR-046: follow the system, or force dark or light. A radio group drawn as a segmented control:
 * three native radios, so VoiceOver reads the choice and the arrow keys move it.
 */
export function ThemeSection() {
  const [preference, choose] = useThemePreference()
  const t = en.settings.theme

  return (
    <section aria-labelledby="theme-heading" className="flex flex-col gap-3 border-b border-border px-4 py-3">
      <h3 id="theme-heading" className="font-semibold">
        {t.section}
      </h3>
      <div role="radiogroup" aria-labelledby="theme-heading" className="flex rounded border border-border">
        {THEME_PREFERENCES.map((option) => (
          <label
            key={option}
            className="touch-target flex flex-1 cursor-pointer items-center justify-center px-2 text-sm first:rounded-l last:rounded-r has-checked:bg-accent has-checked:font-semibold has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-accent"
          >
            <input
              type="radio"
              name="theme"
              value={option}
              checked={preference === option}
              onChange={() => choose(option)}
              className="sr-only"
            />
            {t.options[option]}
          </label>
        ))}
      </div>
    </section>
  )
}
