/**
 * Every user-facing string lives here (CLAUDE.md → "teksty UI po polsku,
 * wyłącznie przez src/i18n/pl.ts"). The shape is ready for an `en.ts` sibling
 * (NF-8) but nothing selects a locale yet.
 */
/** Polish plural: 1 → one, 2–4 (not 12–14) → few, everything else → many. */
function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one
  const tens = count % 100
  const units = count % 10
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few
  return many
}

export const pl = {
  app: {
    name: 'Cezar',
    tagline: 'Podgląd agentów',
  },
  shell: {
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
    /**
     * The key came back unconsumed: either the link is wrong or incomplete, or
     * the server has no unlock at /m/. Both are said, because the app cannot
     * tell them apart.
     */
    unlockFailed: 'Brama nie przyjęła tego linku. Sprawdź, czy link jest skopiowany w całości — razem z końcówką klucza.',
    unlockFailedServer:
      'Jeśli link jest kompletny, serwer nie obsługuje jeszcze odblokowania pod adresem aplikacji — na serwerze trzeba uruchomić deploy/nginx/install.sh.',
    /**
     * Only true in a browser tab. The installed app keeps its own cookies
     * (R-AUTH-1), so a session opened in Safari never reaches it — offering
     * this there would send the operator down a path that cannot work.
     */
    manualTab: 'Możesz też otworzyć link w tej przeglądarce i wrócić tutaj.',
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
  runs: {
    /** US-02: the answer to "does anything need me?", before any row is read. */
    summary: {
      none: 'Nic nie czeka na Ciebie',
      /** Under a project filter, attention elsewhere is still said — never hidden. */
      elsewhere: (count: number) => `${count} w innych projektach`,
      some: (count: number) =>
        `${count} ${plural(count, 'zadanie wymaga', 'zadania wymagają', 'zadań wymaga')} uwagi`,
    },
    loading: 'Wczytuję zadania…',
    sections: {
      attention: 'Wymaga uwagi',
      running: 'W toku',
      queued: 'W kolejce',
      finished: 'Zakończone',
    },
    filter: {
      label: 'Projekt',
      all: 'Wszystkie projekty',
    },
    empty: {
      all: 'Brak zadań. Nowe zadania pojawią się tutaj.',
      project: 'W tym projekcie nie ma zadań.',
    },
    /** A status is never conveyed by colour alone — every dot carries one of these. */
    status: {
      'needs permission': 'prosi o zgodę',
      'needs you': 'czeka na Ciebie',
      'needs review': 'do przeglądu',
      failed: 'błąd',
      scheduled: 'zaplanowane',
      monitoring: 'monitoruje',
      running: 'pracuje',
      queued: 'w kolejce',
      done: 'gotowe',
      cancelled: 'anulowane',
    } as Record<string, string>,
    timing: {
      queued: (position: number) => `#${position} w kolejce`,
      scheduled: (at: string) => `wznowi o ${at}`,
      since: (age: string) => `od ${age}`,
      ago: (age: string) => `${age} temu`,
    },
    unread: 'nieprzeczytane',
    reference: {
      PR: (n: number) => `PR #${n}`,
      Issue: (n: number) => `#${n}`,
    },
    showOlder: (count: number) => `Pokaż starsze (${count})`,
    /** FR-012: the live connection's state, always in words. */
    live: {
      live: 'Na żywo',
      connecting: 'Łączę…',
      reconnecting: 'Łączę ponownie…',
      lost: 'Brak połączenia na żywo',
    } as Record<string, string>,
    /** When not live: how old the list on screen is. */
    listFrom: (time: string) => `lista z ${time}`,
    refreshingInline: 'odświeżam…',
    refresh: 'Odśwież',
    refreshing: 'Odświeżam…',
    pull: 'Pociągnij, aby odświeżyć',
    release: 'Puść, aby odświeżyć',
    /** Guardrail: a stale status is never presented as current. */
    refreshFailed: (time: string) => `Nie udało się odświeżyć. Lista pochodzi z ${time}.`,
    loadFailed: 'Nie udało się wczytać zadań.',
    retry: 'Spróbuj ponownie',
    truncated: (limit: number, projects: string) =>
      `Pokazuję tylko ${limit} najnowszych zadań z: ${projects}. Starsze są w pełnym cockpicie.`,
  },
  /** S-05: one task — its header, its plan and the newest stretch of its transcript. */
  run: {
    back: 'Zadania',
    loading: 'Wczytuję zadanie…',
    loadFailed: 'Nie udało się wczytać zadania.',
    notFound: 'Nie ma takiego zadania. Mogło zostać usunięte.',
    retry: 'Spróbuj ponownie',
    refresh: 'Odśwież',
    refreshing: 'Odświeżam…',
    updatedAt: (time: string) => `Zaktualizowano ${time}`,
    /** S-06, when the task's stream is not live: how old the screen is. */
    stateFrom: (time: string) => `stan z ${time}`,
    /** FR-019: scrolled up while the agent wrote more. */
    newMessages: 'Nowe wiadomości',
    /** Guardrail: a stale status is never presented as current. */
    refreshFailed: (time: string) => `Nie udało się odświeżyć. Stan z ${time}.`,
    header: {
      workflow: 'Workflow',
      step: (position: number, total: number, name: string) =>
        `Krok ${position}/${total}${name ? ` · ${name}` : ''}`,
      agent: 'Agent',
      cost: 'Koszt',
      tokens: 'Tokeny',
      tokensDirectional: (input: string, output: string) => `we ${input} · wy ${output}`,
      branch: 'Gałąź',
      pr: (number: string | null) => (number ? `PR #${number}` : 'Pull request'),
    },
    plan: {
      title: 'Plan',
      progress: (done: number, total: number) => `${done}/${total}`,
      /** Glyph + word, never colour alone. */
      status: {
        completed: 'zrobione',
        in_progress: 'w trakcie',
        pending: 'do zrobienia',
        cancelled: 'niepotrzebne',
      } as Record<string, string>,
    },
    transcript: {
      heading: 'Transkrypt',
      /** FR-049 is parked: only the newest page is shown. */
      older: 'Starsze wpisy są dostępne w pełnym cockpicie.',
      empty: 'Transkrypt jest jeszcze pusty.',
      loadFailed: 'Nie udało się wczytać transkryptu.',
      task: 'Zadanie',
      you: 'Ty',
      imagesAttached: (count: number) =>
        `${count} ${plural(count, 'załącznik', 'załączniki', 'załączników')}`,
      reasoning: 'Rozumowanie',
      tool: {
        input: 'Wejście',
        output: 'Wynik',
        error: 'Błąd',
        exitCode: (code: number) => `kod wyjścia ${code}`,
        clipped: (count: number) => `… pominięto ${count} znaków z początku`,
        children: (count: number) =>
          `${count} ${plural(count, 'krok podagenta', 'kroki podagenta', 'kroków podagenta')}`,
        /** Status glyph + word per `ToolStatus`; unknown statuses show their raw name. */
        status: {
          pending: 'oczekuje',
          running: 'w trakcie',
          completed: 'gotowe',
          failed: 'błąd',
          declined: 'odrzucone',
        } as Record<string, string>,
      },
      image: (name?: string) => `Obraz${name ? ` ${name}` : ''} — do obejrzenia w pełnym cockpicie`,
      providerAuth: (provider: string) =>
        `Agent ${provider} stracił logowanie. Zaloguj go ponownie w pełnym cockpicie.`,
      ask: {
        title: 'Pytanie agenta',
        answered: (answer: string) => `Odpowiedź: ${answer}`,
        pending: 'Czeka na odpowiedź',
      },
      footer: {
        waiting: 'Agent czeka na Twoją odpowiedź.',
        failed: 'Sesja zakończona błędem.',
        failedWith: (error: string) => `Sesja zakończona błędem — ${error}`,
        review: 'Sesja zamknięta — czeka na Twój przegląd.',
        closed: 'Sesja zamknięta.',
      },
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
