/**
 * Every user-facing string lives here (CLAUDE.md → "teksty UI po polsku,
 * wyłącznie przez src/i18n/pl.ts"). The shape is ready for an `en.ts` sibling
 * (NF-8) but nothing selects a locale yet.
 */
export const pl = {
  app: {
    name: 'Cezar',
    tagline: 'Podgląd agentów',
  },
  shell: {
    /** M0 placeholder — M1 replaces this with the runs list. */
    empty: 'Szkielet aplikacji działa. Lista zadań pojawi się w kolejnym etapie.',
    openCockpit: 'Otwórz w pełnym cockpicie',
  },
  update: {
    available: 'Nowa wersja aplikacji',
    action: 'Odśwież',
    dismiss: 'Później',
  },
  offline: {
    banner: 'Brak połączenia — dane mogą być nieaktualne',
  },
} as const

export type Messages = typeof pl
