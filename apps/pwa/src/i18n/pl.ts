import type { ApiErrorCode } from '../api/http.ts'

/**
 * Every user-facing string lives here (CLAUDE.md: UI text in Polish, only through
 * `src/i18n/pl.ts`). The shape is ready for an `en.ts` sibling (NF-8) but nothing
 * selects a locale yet.
 */

/** Said in two places: a `not-routed` answer and every other way the sidecar goes quiet. */
const PUSH_UNAVAILABLE = 'Serwer powiadomień nie odpowiada. Spróbuj później.'

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
  /**
   * What this app judged about an answer, keyed by `ApiError.code` (`api/http.ts`). Never the
   * server's own reason — that one is shown verbatim (FR-032) and needs no translation.
   */
  apiError: {
    'unexpected-shape': 'Cezar odpowiedział w nieznanym formacie',
    'invalid-json': 'Odpowiedź Cezara nie jest poprawnym JSON-em',
    'not-routed': PUSH_UNAVAILABLE,
    /** A bare status is not a reason: the screen's own "nie udało się…" already said that much. */
    'no-detail': '',
  } satisfies Record<ApiErrorCode, string>,
  /** Compact age, one unit, as `shortAge` (`domain/run-display.ts`) measures it. */
  age: {
    seconds: (count: number) => `${count} s`,
    minutes: (count: number) => `${count} min`,
    hours: (count: number) => `${count} godz.`,
    days: (count: number) => (count === 1 ? '1 dzień' : `${count} dni`),
  },
  shell: {
    openCockpit: 'Otwórz w pełnym cockpicie',
    /** S-12, FR-048: the task's own screen, in the cockpit. Short: it sits in the top bar. */
    openTaskInCockpit: 'W cockpicie',
    openTaskInCockpitLabel: 'Otwórz to zadanie w pełnym cockpicie',
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
      /** S-09: the row that opens the diff. */
      changes: 'Zmiany',
      showChanges: 'Pokaż zmiany',
    },
    /** S-09: the task's diff, file by file, read-only (FR-031). */
    diff: {
      back: 'Zadanie',
      title: 'Zmiany',
      loading: 'Wczytuję zmiany…',
      loadFailed: 'Nie udało się wczytać zmian.',
      /** A 409: the server's own reason follows, e.g. the task ran without a worktree. */
      refused: 'Brak zmian do pokazania.',
      empty: 'Brak zmian — worktree zgadza się z gałęzią bazową.',
      emptyActive: 'Agent jeszcze niczego nie zmienił. Zmiany pojawią się tutaj w trakcie pracy.',
      files: (count: number) => `${count} ${plural(count, 'plik', 'pliki', 'plików')}`,
      countsLabel: (adds: number, dels: number) =>
        `${adds} ${plural(adds, 'linia dodana', 'linie dodane', 'linii dodanych')}, ${dels} ${plural(dels, 'usunięta', 'usunięte', 'usuniętych')}`,
      repointed: (head: string, task: string) =>
        `Worktree jest na gałęzi ${head}, nie na gałęzi zadania ${task} — widać tylko to, co zadanie tam zmieniło.`,
      status: {
        added: 'nowy',
        modified: 'zmieniony',
        deleted: 'usunięty',
        renamed: 'przeniesiony',
        copied: 'skopiowany',
      } as Record<string, string>,
      /** A status the vocabulary grew after `v0.11.0` (rule 5). */
      statusUnknown: 'zmieniony',
      renamedFrom: (path: string) => `z ${path}`,
      binary: 'Plik binarny — brak podglądu tekstowego.',
      image: 'Obraz — podgląd tylko w cockpicie.',
      noContent: 'Bez zmian w treści (zmiana nazwy lub uprawnień).',
      truncated: 'Serwer uciął tę poprawkę — całość jest w cockpicie.',
      openCockpit: 'Otwórz cockpit',
      showMore: (count: number) => `Pokaż kolejne ${count} ${plural(count, 'wiersz', 'wiersze', 'wierszy')}`,
      /** Screen-reader words for the one-character markers. */
      lineKind: { add: 'dodana', del: 'usunięta', context: '' } as Record<string, string>,
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
      /** A markdown image is never loaded (`Markdown.tsx`); this stands in for a missing alt. */
      markdownImageAlt: 'obraz',
      providerAuth: (provider: string) =>
        `Agent ${provider} stracił logowanie. Zaloguj go ponownie w pełnym cockpicie.`,
      ask: {
        title: 'Pytanie agenta',
        answered: (answer: string) => `Odpowiedź: ${answer}`,
        pending: 'Czeka na odpowiedź',
        /** The reducer resolves only the newest question, so an older open one is dead. */
        superseded: 'Agent zadał potem nowe pytanie — odpowiedz na nie niżej.',
        multiSelect: 'zaznacz wszystkie pasujące',
        pickOrWrite: 'Wybierz odpowiedź albo napisz własną w polu na dole.',
        answerEach: 'Odpowiedz na każde pytanie albo napisz własną odpowiedź w polu na dole.',
        send: 'Wyślij odpowiedź',
        sendAndReopen: 'Wyślij i wznów sesję',
        /** Said before the tap: answering a closed session does more than reply. */
        resumeHint: 'Sesja się zakończyła — odpowiedź otworzy ją ponownie i trafi do agenta.',
        sent: 'Odpowiedź wysłana. Czekam, aż pojawi się w transkrypcie.',
      },
      footer: {
        waiting: 'Agent czeka na Twoją odpowiedź.',
        failed: 'Sesja zakończona błędem.',
        failedWith: (error: string) => `Sesja zakończona błędem — ${error}`,
        review: 'Sesja zamknięta — czeka na Twój przegląd.',
        closed: 'Sesja zamknięta.',
      },
    },
    /** S-07: the composer, and why a send did not go through (FR-032). */
    compose: {
      label: 'Wiadomość do agenta',
      placeholder: {
        running: 'Napisz do agenta…',
        waiting: 'Odpowiedz agentowi…',
        queued: 'Dopisz do polecenia…',
        resume: 'Własna odpowiedź — wznowi sesję…',
      },
      hint: {
        queued: 'Zadanie jeszcze nie wystartowało. To, co dopiszesz, trafi do polecenia.',
        resume: 'Sesja się zakończyła. Wysłanie odpowiedzi otworzy ją ponownie.',
      },
      send: 'Wyślij',
      sending: 'Wysyłam…',
      queuedTitle: (count: number) =>
        `${count} ${plural(count, 'wiadomość dopisana', 'wiadomości dopisane', 'wiadomości dopisanych')} do polecenia`,
      deferred: 'Sesja startuje — wiadomość trafi do agenta, gdy tylko się otworzy.',
      failed: {
        /** The server's own words, verbatim (FR-032). */
        refused: (reason: string) => `Cezar odmówił: ${reason}`,
        network: 'Brak połączenia z Cezarem — nic nie zostało wysłane.',
        /** A write that timed out may still have landed; a blind retry could send it twice. */
        timeout: 'Cezar nie odpowiedział na czas. Wiadomość mogła dotrzeć — odśwież, zanim wyślesz ją ponownie.',
        auth: 'Sesja z Cezarem wygasła — połącz się ponownie.',
        unavailable:
          'Sesja się zakończyła i Cezar nie zapisał jej identyfikatora, więc tej odpowiedzi nie da się dostarczyć.',
      },
    },
    /** S-08: the task's own actions (FR-025 to FR-029), and why one did not go through (FR-032). */
    actions: {
      label: 'Akcje zadania',
      archivedBadge: 'Zarchiwizowane',
      pinnedBadge: 'Przypięte',
      cancel: 'Anuluj',
      cancelling: 'Anuluję…',
      /** `waiting` closes the session, `review` accepts the changes: one endpoint, two meanings. */
      finish: { waiting: 'Zakończ', review: 'Akceptuj' } as Record<string, string>,
      finishing: 'Kończę…',
      draftPr: 'Otwórz draft PR',
      draftPrPending: 'Otwieram PR…',
      continue: 'Kontynuuj',
      continuing: 'Wznawiam…',
      pin: 'Przypnij',
      unpin: 'Odepnij',
      pinning: 'Zapisuję…',
      archive: 'Archiwizuj',
      unarchive: 'Przywróć z archiwum',
      archiving: 'Zapisuję…',
      confirmCancel: {
        title: 'Anulować to zadanie?',
        body: 'Agent zostanie zatrzymany, a zadanie zakończy się jako anulowane. Worktree zostaje.',
        keep: 'Zostaw',
        confirm: 'Anuluj zadanie',
      },
      done: {
        cancel: 'Zadanie anulowane.',
        alreadySettled: 'Zadanie zdążyło się zakończyć — nie było czego anulować.',
        accepted: 'Zmiany zaakceptowane, zadanie zakończone.',
        finished: 'Sesja zamknięta.',
        draftPr: 'Draft PR otwarty — link jest w nagłówku.',
        draftPrDryRun: 'Tryb próbny Cezara: PR nie został naprawdę otwarty.',
        continued: 'Sesja wznowiona.',
        archived: 'Zadanie zarchiwizowane — zniknęło z listy.',
      },
      failed: {
        /** The server's own words, verbatim (FR-032). */
        refused: (reason: string) => `Cezar odmówił: ${reason}`,
        network: 'Brak połączenia z Cezarem — nic się nie zmieniło.',
        /** A write that timed out may still have happened; a blind retry could do it twice. */
        timeout: 'Cezar nie odpowiedział na czas. Akcja mogła się wykonać — odśwież, zanim spróbujesz ponownie.',
        auth: 'Sesja z Cezarem wygasła — połącz się ponownie.',
      },
    },
  },
  settings: {
    title: 'Ustawienia',
    /** The footer link that opens the screen. */
    open: 'Ustawienia',
    back: 'Lista zadań',
    /** S-12, FR-046. */
    theme: {
      section: 'Motyw',
      options: { system: 'Jak w systemie', dark: 'Ciemny', light: 'Jasny' } as Record<string, string>,
    },
    /** S-12, FR-047. Both versions, and nothing more: the "Cezar is newer" warning is a non-goal. */
    versions: {
      section: 'Wersje',
      app: 'Aplikacja',
      /** The build's commit and when it was built. */
      appValue: (commit: string, builtAt: string | undefined) =>
        builtAt ? `${commit} · zbudowana ${builtAt}` : commit,
      cezar: 'Cezar',
      cezarUnknown: 'nieznana — brak połączenia',
      tested: 'Sprawdzona z Cezarem',
    },
    /** S-12, FR-006. */
    signOut: {
      section: 'Wylogowanie',
      intro:
        'Usuwa z tego telefonu wszystko, co przechowuje aplikacja, wyłącza powiadomienia na tym urządzeniu i kończy sesję. Żeby wrócić, potrzebny będzie link dostępowy.',
      action: 'Wyloguj',
      confirmTitle: 'Wylogować z Cezara?',
      confirmBody: 'Po wylogowaniu aplikacja poprosi o link dostępowy.',
      confirm: 'Wyloguj',
      keep: 'Anuluj',
      working: 'Wylogowuję…',
      /** The perimeter did not confirm: local data and notifications are done, the cookie is not. */
      sessionKept:
        'Dane z telefonu usunięte, ale serwer nie potwierdził zakończenia sesji — aplikacja nadal ma dostęp do Cezara. Spróbuj ponownie przy dostępie do sieci.',
      notificationsKept:
        'Nie udało się wyłączyć powiadomień na tym urządzeniu. Wyłącz je w Ustawieniach iOS → Powiadomienia → Cezar.',
      retry: 'Spróbuj ponownie',
    },
  },
  /** S-10: notifications — the settings section and the notification text itself. */
  push: {
    section: 'Powiadomienia',
    /** FR-038, FR-043: what a notification says, and what it never carries. */
    intro:
      'Powiadomienie przychodzi, gdy zadanie czeka na Twoją odpowiedź, na przegląd albo zakończyło się błędem. Zawiera tytuł zadania, projekt i powód — bez kodu i bez treści rozmowy.',
    /** FR-037: in a browser tab the permission prompt cannot work on iOS. */
    installTitle: 'Najpierw dodaj Cezara do ekranu początkowego',
    installBody:
      'Na iPhonie powiadomienia działają tylko w aplikacji otwartej z ikony. W Safari naciśnij „Udostępnij”, potem „Dodaj do ekranu początkowego”, i otwórz Cezara z ekranu początkowego.',
    unsupported: 'To urządzenie nie obsługuje powiadomień (potrzebny iOS 16.4 lub nowszy).',
    denied: 'Powiadomienia są zablokowane. Włącz je w Ustawieniach iOS → Powiadomienia → Cezar.',
    checking: 'Sprawdzam powiadomienia…',
    off: 'Powiadomienia są wyłączone.',
    on: 'Powiadomienia są włączone na tym urządzeniu.',
    enable: 'Włącz powiadomienia',
    enabling: 'Włączam…',
    disable: 'Wyłącz powiadomienia',
    disabling: 'Wyłączam…',
    test: 'Wyślij powiadomienie testowe',
    testing: 'Wysyłam…',
    testSent: 'Wysłane — powiadomienie powinno pojawić się za chwilę.',
    errors: {
      dismissed: 'Nie udzielono zgody na powiadomienia.',
      unknownDevice: 'Serwer nie zna tego urządzenia — wyłącz i włącz powiadomienia ponownie.',
      gone: 'Usługa powiadomień nie zna już tego urządzenia — włącz powiadomienia ponownie.',
      unavailable: PUSH_UNAVAILABLE,
      /** The sidecar answered, but not in its own shape — `ApiError.code` said so. */
      unexpectedShape: 'Serwer powiadomień odpowiedział w nieznanym formacie',
      auth: 'Sesja z Cezarem wygasła — połącz się ponownie.',
      failed: (reason: string) => `Nie udało się: ${reason}`,
    },
    /** The notification body says why, keyed by the attention label (`deriveAttention().label`). */
    reason: {
      'needs you': 'Czeka na Twoją odpowiedź',
      'needs review': 'Czeka na przegląd',
      failed: 'Zakończone błędem',
      'needs permission': 'Prosi o zgodę',
    } as Record<string, string>,
    fallbackTitle: 'Cezar',
    fallbackReason: 'Wymaga uwagi',
    testTitle: 'Cezar',
    testBody: 'Powiadomienia działają.',
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
