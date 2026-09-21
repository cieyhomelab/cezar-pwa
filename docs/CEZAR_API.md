# Cezar API — ściąga dla PWA

Źródło: `open-mercato/cezar` @ tag `v0.11.0` (`67fc941`) — wersja, którą raportuje instancja na VPS (`GET /api/v1/health`, 2026-09-21). Kontrakt jest zvendorowany z tego samego commita (`packages/cezar-contract/UPSTREAM`).
Pliki źródłowe prawdy (sprawdzaj je przy każdej aktualizacji Cezara):

- `packages/contract/src/*.ts` — schematy zod wszystkich requestów/odpowiedzi (`runs.ts`, `events.ts`, `health.ts`, `workspace.ts`, `projects.ts`)
- `packages/api-client/src/protocol/ui-events.ts` — słownik zdarzeń agenta (SSE, `ui-event`)
- `packages/cezar/src/server/server.ts` — definicje tras, guardy, SSE
- `packages/web/src/lib/attention.ts` — logika „wymaga uwagi” (kopiujemy ją 1:1)
- `BACKWARD_COMPATIBILITY.md` — co jest zamrożone, a co może się zmienić

## 1. Zasady ogólne

- Używamy **wyłącznie** powierzchni wersjonowanej `/api/v1/…`. Stare `/api/…` są zamrożone dla bookmarkletów — nie budujemy na nich.
- Każda trasa projektowa istnieje w dwóch wariantach: `/api/v1/<path>` (projekt, w którym Cezar wystartował) i `/api/v1/p/:projectId/<path>`. **PWA zawsze używa wariantu z `projectId`**, bo pokazuje zadania ze wszystkich projektów.
- Cezar **nie ma własnego uwierzytelniania** — perimeter to reverse proxy (u nas: nginx + cookie). `createCezarClient({ token })` ma opcję Bearer, ale serwer jej dziś nie wymaga. Szczegóły bramy: sekcja 1a.
- **Guard same-origin (#426):** każdy `POST/PUT/PATCH/DELETE` z nagłówkiem `Origin` innym niż `Host` → `403`; `Sec-Fetch-Site: cross-site` → `403`. CORS jest otwarty tylko dla `GET /api/v1/health`. ⇒ **PWA musi być serwowana z tego samego originu** (`https://cezar.ciey.studio`), inaczej zapisy i odczyty nie zadziałają.
- Błędy mają kształt `{ "error": string }` + kod HTTP (400 walidacja, 404 brak, 409 konflikt stanu).

## 1a. Brama nginx — zweryfikowane na żywej instancji (2026-09-20)

Zbadane bezpośrednio na VPS-ie. Zastępuje domysły; jeśli konfiguracja nginx się zmieni, ta sekcja wymaga ponownego sprawdzenia.

**Ciasteczko sesji**

- `Max-Age=2592000` (30 dni), `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`.
- **Nie jest przesuwne.** `Set-Cookie` leci **wyłącznie** na trafienie `?key=`; zwykły request z ważnym ciasteczkiem zwraca 200 bez `Set-Cookie`. Zegar tyka od kliknięcia linku, niezależnie od intensywności korzystania.
- Wartość ciasteczka to **statyczny sekret współdzielony, identyczny z parametrem `key`**. Nie ma sesji per-użytkownik ani server-side store; odwołanie = edycja obu plików + reload nginx.
- `HttpOnly` ⇒ **JS nigdy nie zobaczy tego ciasteczka.** PWA nie odczyta go, nie sprawdzi daty wygaśnięcia, nie odnowi. Proaktywne „zostało ci 3 dni" jest niewykonalne — jedyny sygnał to 403 w locie.

**Brak sesji = goła odmowa**

- `403`, `Content-Type: text/html`, 148 bajtów statycznego HTML-a. Bez `Location`, bez `WWW-Authenticate`, bez CORS, bez `Cache-Control`.
- Identycznie dla `GET`, `POST`, XHR, SSE i deep-linków. Stale ciasteczko daje dokładnie to samo co brak ciasteczka.
- **Nie ma przekierowania i nie ma strony logowania.** „Połącz z Cezarem" nie może być logowaniem — aplikacja za bramą nie ma żadnej autoryzacji (`http://127.0.0.1:4322/` zwraca 200 bez poświadczeń). Jedyny możliwy kształt to: wykryj 403 → pokaż ekran ponownego odblokowania.
- Tania sonda stanu sesji: `GET /api/v1/health` — z ciasteczkiem JSON z wersją, bez ciasteczka 403.

**Link odblokowujący nie przyjmuje parametru powrotu**

- Guard ma kształt `if ($arg_key = "…") { add_header Set-Cookie …; return 302 https://$host$uri; }`. `$uri` to sama ścieżka — **cały query string ginie**.
- Cel powrotu koduje się więc **w ścieżce** linku odblokowującego, nie w parametrze.
- Dwie pułapki: `$uri` jest zdekodowane (`/p/x/run%20one?key=…` → `Location: …/run one`, nagłówek ze spacją), i nie da się przenieść stanu trzymanego w query paramach.
- PWA i tak nie może zbudować takiego linku — zawierałby sekret, a ten nigdy nie trafia do naszego storage (guardrail PRD).

**Jak korzysta z tego PWA (S-02, wdrożone 2026-09-20)**

- Sonda sesji: `GET /api/v1/health` przez `apps/pwa/src/api/http.ts`. `401/403` **albo** odpowiedź nie-JSON → `AuthRequiredError` → ekran „Połącz z Cezarem”. Błąd sieci/timeout → `NetworkError` → osobny ekran „nie mogę się połączyć”; te dwa stany nigdy się nie mieszają.
- Ponowna sonda przy każdym `visibilitychange → visible` — ciasteczka nie da się odczytać, więc jedyną odpowiedzią na „czy sesja jeszcze żyje” jest zapytanie, a iOS zamraża aplikację na godziny.
- Odblokowanie: wklejony link → zostaje sam `key`, **surowy, bajt w bajt** → **ścieżka podmieniona na `/m/`** → `location.replace`. Ścieżka jest jedynym nośnikiem celu powrotu (`return 302 https://$host$uri`), więc to jedyny kształt, jaki może zadziałać. Surowość jest konieczna: `$arg_key = "…"` porównuje nieodkodowany query string, więc `%2F` zamiast `/` to inny klucz. Sekret nie trafia nigdzie poza ten jeden request; jeśli wrócimy z niezużytym `key` w URL-u, jest natychmiast usuwany z wpisu historii.
- **Gdzie naprawdę jest bramka (odczytane na hoście 2026-09-21):** `location / { include /etc/nginx/snippets/cezar-gate.conf; proxy_pass … }`. Snippet bramki trzyma guard `?key=` i `if ($cezar_gate_ok = 0) { return 403 …; }`; zmienna pochodzi z `map` w `/etc/nginx/conf.d/cezar-gate.conf`. Ciasteczko nazywa się `cezar_gate`. vhost przepisuje `cezar server-install`; `cezar-gate-ensure.path`/`.timer` przywracają wyłącznie include bramki.
- **Guard stoi w `location /` — potwierdzone 2026-09-21** (prawdziwy link w zainstalowanej PWA był ignorowany; `/m/` bez ciasteczka daje 200, więc kontrola bramy nie działa na poziomie `server`). `location ^~ /m/` nigdy go nie widzi, dlatego snippet `/m/` includuje kopię guarda — patrz niżej.

**Konsekwencje dla wdrożenia — do `deploy/nginx/`**

- **Pod `/m/` potrzebna jest kopia guarda `?key=`** (i tylko jego — nie kontroli ciasteczka). Snippet ma `include /etc/nginx/snippets/cezar-mobile-unlock*.conf;`, a `deploy/nginx/install.sh` wycina blok `if ($arg_key = …) { … }` z vhosta do tego pliku (mode 600, nigdy nie drukowany; sekret nie trafia do repo). Glob — brak pliku nie psuje `nginx -t`, tylko wyłącza odblokowanie. Po zmianie klucza **uruchom instalator ponownie**. Weryfikacja bez VPS: `deploy/nginx/rehearse.sh`.
- **`location /m/` musi stać POZA guardem `?key=`.** Zainstalowana PWA ma na iOS osobne ciasteczka od Safari, więc start z ikony leci bez ciasteczka. Jeśli powłoka jest za bramą, użytkownik dostaje 148-bajtowy 403 HTML **pod adresem app shella** i nie ma czego wyrenderować — ekran „Połącz z Cezarem" nigdy się nie pokaże. Chronione zostaje wyłącznie `/api/**`.
- **Service worker musi jawnie odrzucać `!response.ok` przed zapisem do cache'u.** Odpowiedź 403 nie ma `Cache-Control`, jest `text/html` i przychodzi pod tym samym URL-em co powłoka — SW potrafi utrwalić stronę błędu jako app shell. Poprawne 200 z cockpitu niesie `Cache-Control: no-cache`.

## 2. Odczyt — co PWA pobiera

| Cel | Metoda i ścieżka | Odpowiedź (schemat) |
|---|---|---|
| Wersja, projekty, capabilities | `GET /api/v1/health` | `healthResponseSchema`: `version`, `projects[{id,name}]`, `bootProject`, `capabilities{…}`, `checks[]` |
| Lista zadań ze **wszystkich** projektów | `GET /api/v1/workspace/runs-index` | `runsIndexResponseSchema`: `runs: RunIndexEntry[]` (najnowsze pierwsze, max 200/projekt), `truncated[]` |
| Lista projektów | `GET /api/v1/projects` | rejestr projektów |
| Szczegóły zadania | `GET /api/v1/p/:projectId/runs/:id` | `ApiRun` (= `RunRecord` + pola API) |
| Transkrypt – strona historii (od końca) | `GET /api/v1/p/:projectId/runs/:id/history?cursor=` | `RunHistoryPage`: `events[]` (max 100), `olderCursor`, `liveCursor`, `asOfSeq`, `hasOlder` |
| Diff zadania | `GET /api/v1/p/:projectId/runs/:id/diff` | tekst/struktura diffu |
| Zmienione pliki | `GET /api/v1/p/:projectId/runs/:id/changes` | lista plików |
| Commity zadania | `GET /api/v1/p/:projectId/runs/:id/commits` | `{ commits: RunCommit[] }` |
| Notatki przekazania | `GET /api/v1/p/:projectId/runs/:id/handoff` | Markdown |
| Obrazek z transkryptu | `GET /api/v1/p/:projectId/runs/:id/images/:file` | bajty obrazu |
| Workflowy (do composera) | `GET /api/v1/p/:projectId/workflows` | lista workflowów |
| Modele | `GET /api/v1/p/:projectId/models` | modele per runner |

### RunStatus
`queued | running | waiting | review | done | failed | cancelled`
plus `activity: 'monitoring'` (podstan `running` — agent czeka na własną pracę w tle, **nie** wymaga uwagi) oraz `autoResumeAt` (zadanie `failed` przez limit dostawcy, wznowi się samo → traktuj jak „zaplanowane”, nie jak błąd).

### Lista zadań w PWA (S-03) — jak czytamy `runs-index`
- Jedno zapytanie `GET /api/v1/workspace/runs-index` (trasa workspace — nie ma wariantu `/p/:projectId/`), klucz `['runs-index']`. Nazwy projektów z `GET /api/v1/health` → `projects[]` (już w cache po sondzie sesji).
- Odpowiedź **nie jest** walidowana schematem zod w runtime: enumy kontraktu są zamknięte, a słownik rośnie. Sprawdzamy tylko, że `runs` jest tablicą — inaczej błąd, nigdy pusta lista („nic nie czeka” byłoby nieprawdą). Schematy walidują fixture'y w testach (`apps/pwa/test/contract/`).
- Sekcje PRD (FR-008): Wymaga uwagi / W toku / W kolejce (+ zaplanowane wznowienia) / Zakończone; zarchiwizowane ukryte. Kolejność w sekcji = `sortRuns` z `web/src/lib/task-groups.ts`. Numer w kolejce liczony dla całego workspace'u (semafor `maxParallel` jest wspólny dla projektów).
- Odświeżanie: przy powrocie na pierwszy plan (`refetchOnWindowFocus: 'always'`), co 30 s gdy widoczna (do czasu SSE w S-04), przyciskiem i gestem „pociągnij”. 401/403 → ponowna sonda `health` → ekran „Połącz z Cezarem”.
- `runs-index` **nie niesie** `pinned` ani `groupId` — lista PWA nie ma więc sekcji „Przypięte” ani zwijania wariantów.

### Kluczowe pola `RunIndexEntry` (lista)
`projectId, id, title, titleSummary, status, activity, createdAt, startedAt, finishedAt, seenAt, archived, autoResumeAt, workflow, branch, pullRequestUrl, prNumber, issueNumber, costUsd, peakRssBytes, usage{cpu,rss…}`

### Dodatkowe pola `RunRecord` (szczegóły)
`task, steps[{id,name,kind:'agent'|'check',status,…}], currentStepId, diffStat, model, runner, autonomous, queuedMessages[], tokensUsed, inputTokens, outputTokens, error, worktreePath, groupId, variant, pinned`

## 3. Strumienie na żywo (SSE)

Wszystkie wysyłają `ping` co kilkanaście sekund. Nagłówki anty-buforujące są ustawiane przez serwer; nginx musi mieć `proxy_buffering off` (instalator Cezara już to robi).

### 3a. `GET /api/v1/workspace/events` — cały workspace (ekran listy)
| event | data |
|---|---|
| `run` | pełny `RunRecord` po każdej zmianie (ze stemplem projektu) |
| `run-deleted` | `{ id, projectId }` |
| `todos` | lista follow-upów (tylko przy `CEZ_FOLLOWUPS=1`) |
| `usage` | próbki CPU/RSS działających zadań |
| `project-added` / `project-removed` | wpis projektu |
| `provider-status` | stan logowania agentów |
| `automation-change` | zmiana automatyzacji |
| `ping` | pusty |

Uwaga: przy reconnect nie ma replay — po wznowieniu **zawsze** refetch `runs-index`.

### 3b. `GET /api/v1/p/:projectId/runs/:id/events` — jedno zadanie (ekran szczegółów)
- Parametry wznowienia: `?afterSeq=<n>` lub nagłówek `Last-Event-ID` (EventSource wysyła go sam), opcjonalnie `?cursor=<liveCursor>` z `/history`.
- Najpierw replay zdarzeń po `afterSeq`, potem live.
- event `run` — aktualny `RunRecord`
- event `ui-event` — zdarzenie protokołu v2 (poniżej), `data` = `{ seq, ts, stepId?, type, …payload }`
- event `run-event` — stare zdarzenia v1 (starsze nagrania); renderuj jako surowy wpis
- event `ping`

### 3c. Protokół zdarzeń agenta (`ui-event`, `type`)
`session.started | session.ended | session.error | turn.started | turn.completed (usage, costUsd) | item.started | item.delta (field: text|reasoning|output, delta) | item.updated | item.completed | plan.updated (entries[]) | permission.requested | permission.resolved | ask.requested (questions[]) | usage.updated`

Itemy (`item`): `message` (role, text, phase), `reasoning`, `tool` (name, toolKind, title, status, input, output, error, diffs[], exitCode). Stream jest **id-keyed**: `item.started` → wiele `item.delta` (doklejaj do pola) → `item.completed` (stan końcowy, nadpisuje).

Słownik jest **append-only** — nieznany `type` musi być bezpiecznie ignorowany/renderowany ogólnie, nigdy nie może wywalić UI.

### 3d. WebSocket `GET /api/v1/ws`
Istnieje po stronie Cezara (topiki na żądanie, np. `health`), ale **nie przechodzi przez bramę** — zweryfikowane 2026-09-20. Vhost ustawia `proxy_set_header Connection ''` i nie przekazuje `Upgrade`, więc upgrade do WebSocketu nie przejdzie. To ograniczenie transportu, nie decyzja produktowa: **SSE jest jedyną drogą do strumienia zdarzeń.**

SSE natomiast przechodzi potwierdzenie: `/api/v1/events` i `/api/v1/p/:projectId/events` zwracają `text/event-stream` przez bramę (`proxy_buffering off`, read timeout 3600 s).

## 4. Akcje (zapis) — wymagają same-origin

| Akcja | Metoda i ścieżka | Body |
|---|---|---|
| Nowe zadanie | `POST /api/v1/p/:projectId/runs` → 201 | `{ task, workflow? \| steps?, runner?, model?, autonomous?, variants?(1-3), worktree?, images?(max 4) }` — dokładnie jedno z `workflow`/`steps`; domyślny workflow `quick-task` |
| Wiadomość do działającej sesji / odpowiedź na `ask.requested` | `POST /api/v1/p/:projectId/runs/:id/messages` | `{ text, images? }` (odpowiedź na pytanie = jedna połączona wiadomość, patrz `web/src/routes/task-thread/ask-card.tsx`) |
| Anuluj | `POST …/runs/:id/cancel` | — → `{ cancelled }` |
| Kontynuuj (zakończony run) | `POST …/runs/:id/continue` | — |
| Zakończ / zaakceptuj review | `POST …/runs/:id/finish` | — |
| Draft PR | `POST …/runs/:id/pr` → 201 | — → `{ url… }` |
| Oznacz jako przeczytane / nieprzeczytane | `POST …/runs/:id/read` / `…/unread` | — |
| Przypnij / odepnij | `POST …/runs/:id/pin` | `{}` lub `{ pinned:false }` |
| Archiwizuj | `POST …/runs/:id/archive` | — |
| Anuluj auto-wznowienie | `DELETE …/runs/:id/auto-resume` | — |

Akcja na `permission.requested`: mechanizm odpowiedzi do potwierdzenia w `packages/web/src/routes/task-thread/` przed implementacją (domyślnie Cezar działa z `dontAsk`, więc prośby o uprawnienia pojawiają się tylko przy `CEZ_APPROVAL_GATE=1`).

## 5. „Wymaga uwagi” — reguła powiadomień

Kopia 1:1 `deriveAttention()` z `packages/web/src/lib/attention.ts` @ `v0.11.0` → `packages/shared/src/attention.ts` (uzgodniona ze źródłem 2026-09-21, razem z testami tablicowymi upstreamu). Zwraca `{ bucket, tone, pulse, label }`, first-match-wins:
1. oczekujące `permission.requested` → `permission` — **na sztywno `false` także upstream, gałąź nieosiągalna, patrz 5a**
2. `failed` + `autoResumeAt` → `none` / „scheduled” — **bez** uwagi
3. `failed` → `error`
4. `waiting` → `waiting` / „needs you”
5. `review` → `waiting` / „needs review”
6. `running` + `activity: 'monitoring'` → `running` / „monitoring” — bez uwagi
7. `running` → `running`; `queued`, `done`, reszta → `none` (**ostatni szczebel to catch-all z etykietą „cancelled”** — PWA pokazuje nieznany status jako jego surową nazwę, nie jako „anulowane”)

„Wymaga uwagi” = `wantsAttention()` = kubełki `permission | error | waiting` (czyli `waiting`, `review`, `failed` bez `autoResumeAt`). To predykat powiadomień w cockpicie i **ta sama** odpowiedź dla górnej sekcji listy PWA i odznaki (PRD, Business Logic). Uwaga: pasek boczny cockpitu ma węższy kubełek „Needs you” (tylko `waiting`/`review`; `failed` ląduje w „Recent”) — PRD świadomie idzie za regułą powiadomień, nie za paskiem bocznym.

Przeczytane/nieprzeczytane (znacznik w wierszu) to osobny kanał: kopia `web/src/lib/read-state.ts` → `packages/shared/src/read-state.ts` (`isUnread`: `done`/`failed`, nie zarchiwizowane, nie zaplanowane, `seenAt < finishedAt`).

Powiadamiamy przy **wejściu** zadania w stan wymagający uwagi (przejście, nie stan), tak jak `web/src/lib/notifications.ts`.

### 5a. `permission.requested` jest martwym typem (zweryfikowane 2026-09-20)

Gałąź 1 nigdy się nie wykona na tej instancji. Trzy warstwy dowodu:

1. **Przełącznik nie jest ustawiony.** `CEZ_APPROVAL_GATE` czytany w `dist/core/claude-cli-runner.js:322` (`env.CEZ_APPROVAL_GATE === '1' ? 'acceptEdits' : 'dontAsk'`). Żywy proces ma z cezarowych zmiennych tylko `CEZ_REMOTE=1`; unit deklaruje `CEZ_REMOTE` i `PATH`. Runner startuje z `--permission-mode dontAsk`.
2. **`dontAsk` z definicji nie generuje promptów.** Narzędzia z `--allowedTools` przechodzą, reszta jest odrzucana zamiast pytać. Odmowa ląduje jako `ToolStatus: 'declined'`, nie jako prośba o zgodę.
3. **Samo zdarzenie nie ma emitera.** `dist/core/ui-events.d.ts:270`, `UiPermissionRequestedEvent`, z komentarzem `RESERVED — wired when auto-approve becomes optional. Types only for now.` Trafienia: 2 w `.d.ts`, 0 w runtime `.js`, 0 w całym web UI.

Drugi runner nie zmienia obrazu: `codex` ma `approvalPolicy: 'never'` zaszyte na sztywno (`codex-app-server-runner.js:291`), a i tak `codex.available: false`, `defaultRunner: claude`.

**Zastrzeżenie:** ustawienie `CEZ_APPROVAL_GATE=1` tej gałęzi **nie ożywi**. Zmienna przełącza wyłącznie tryb uprawnień CLI na `acceptEdits`; Cezar nadal nie ma kodu, który zamieniłby `control_request can_use_tool` w zdarzenie UI. Ożywienie tej ścieżki to zmiana w Cezarze — poza zasięgiem PWA (patrz reguła 7 w `CLAUDE.md`: zgłaszamy jako propozycję issue upstream).

**Co z tym robimy w kodzie:** gałąź **zostaje** w `packages/shared/attention.ts`. Reguła 8 wymaga kopii 1:1 z Cezara, a słownik zdarzeń jest append-only — emiter może dojść w dowolnej wersji. Usunięcie gałęzi rozjechałoby nas z cockpitem dokładnie w momencie, w którym Cezar ją podłączy. Traktujemy ją jako nieosiągalną, nie jako nieistniejącą: bez testów E2E, bez UI do odpowiadania na prośbę o zgodę, z testem jednostkowym trzymającym zgodność z oryginałem.
