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
  auth: {
    /** The first probe, before anything is known. */
    checking: 'Sprawdzam połączenie z Cezarem…',
    title: 'Połącz z Cezarem',
    /** Says plainly that this is not a login — there is no account to log into. */
    intro:
      'Aplikacja nie ma własnego logowania. Dostępu udziela brama przed Cezarem, a zainstalowana aplikacja ma własne ciasteczka — dlatego trzeba ją odblokować osobno.',
    linkLabel: 'Wklej link dostępowy',
    linkPlaceholder: 'https://cezar.ciey.studio/…?key=…',
    submit: 'Połącz',
    /** Reassurance that pasting a secret here is safe. R-AUTH-5. */
    privacy: 'Link nie jest nigdzie zapisywany — służy tylko do przejścia przez bramę.',
    /** The fallback when the gateway ignores the key at the app's own path. */
    unlockFailed:
      'Brama nie przyjęła linku pod adresem aplikacji. Otwórz link w Safari, a potem wróć tutaj — aplikacja sama sprawdzi połączenie.',
    manual: 'Możesz też otworzyć link w Safari i wrócić do aplikacji.',
    recheck: 'Sprawdź ponownie',
    rechecking: 'Sprawdzam…',
    errors: {
      empty: 'Wklej link dostępowy.',
      notAUrl: 'To nie wygląda na adres. Skopiuj cały link, razem z „https://”.',
      foreignOrigin: 'Ten link prowadzi pod inny adres niż ta aplikacja.',
      missingKey: 'W linku brakuje parametru „key”. Skopiuj cały link z wiadomości.',
    },
    unreachable: {
      title: 'Nie mogę połączyć się z Cezarem',
      body: 'Nie ma odpowiedzi z serwera. To nie znaczy, że dostęp wygasł — sprawdź sieć i spróbuj ponownie.',
    },
  },
  install: {
    title: 'Dodaj Cezara do ekranu początkowego',
    /** iOS has no install prompt — the operator does it from the Share sheet. */
    ios: 'Naciśnij „Udostępnij”, a następnie „Dodaj do ekranu początkowego”.',
    dismiss: 'Nie teraz',
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
