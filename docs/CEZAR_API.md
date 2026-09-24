# Cezar API — ściąga dla PWA

Źródło: `open-mercato/cezar` @ tag `v0.11.1` (`4763447`) — wersja, którą raportuje instancja na VPS (`GET /api/v1/health`, 2026-09-24; wcześniej `v0.11.0` / `67fc941`). Między `v0.11.0` a `v0.11.1` kontrakt zmienił się tylko addytywnie (zdarzenia automatyzacji dla review PR + filtr `reviewers`, `projects[].unregistered`, dozwolone pisownie rozszerzeń obrazów w nazwach załączników); miejsca opisane niżej jako „@ `v0.11.0`” nie zmieniły się w `v0.11.1`, chyba że zaznaczono inaczej. Kontrakt jest zvendorowany z tego samego commita (`packages/cezar-contract/UPSTREAM`).
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
- **Guard same-origin (#426):** każdy `POST/PUT/PATCH/DELETE` z nagłówkiem `Origin` innym niż `Host` → `403`; `Sec-Fetch-Site: cross-site` → `403`. CORS jest otwarty tylko dla `GET /api/v1/health`. ⇒ **PWA musi być serwowana z tego samego originu** (`https://<your-host>`, czyli `$PUBLIC_ORIGIN`), inaczej zapisy i odczyty nie zadziałają.
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
- **Wylogowanie (S-12, FR-006) robi brama, bo nikt inny nie może.** Ciasteczko jest `HttpOnly`, więc JS go nie usunie, a Cezar nie ma wylogowania (nie ma też logowania). Snippet `/m/` includuje `/etc/nginx/snippets/cezar-mobile-signout*.conf`, który `install.sh` generuje skryptem `deploy/nginx/signout-from-unlock.sh` z `Set-Cookie` wyciętego guarda: bierze **tylko nazwę, `Path` i `Secure`** (nigdy wartość — do wygaszenia ciasteczka wartość nie jest potrzebna). Wynik: `location = /m/session/end` — `POST` z nagłówkiem `Origin` równym `$scheme://$http_host` → **204** + `Set-Cookie: cezar_gate=; Path=/; Max-Age=0; …`. `GET` → 405 (prefetch ani wklejony link nie wylogują), inny lub brak `Origin` → 403. Na hoście bez tego pliku `POST` trafia w statyczną powłokę → 405, a aplikacja mówi, że sesja została. Wylogowuje **tylko ten słoik ciasteczek** — zainstalowana PWA na iOS ma własny, więc Safari i inne urządzenia zostają zalogowane; sekret bramy się nie zmienia (odwołanie dostępu = zmiana klucza). Weryfikacja: `deploy/nginx/rehearse.sh`.
- **`location /m/` musi stać POZA guardem `?key=`.** Zainstalowana PWA ma na iOS osobne ciasteczka od Safari, więc start z ikony leci bez ciasteczka. Jeśli powłoka jest za bramą, użytkownik dostaje 148-bajtowy 403 HTML **pod adresem app shella** i nie ma czego wyrenderować — ekran „Połącz z Cezarem" nigdy się nie pokaże. Chronione zostaje wyłącznie `/api/**`.
- **Service worker musi jawnie odrzucać `!response.ok` przed zapisem do cache'u.** Odpowiedź 403 nie ma `Cache-Control`, jest `text/html` i przychodzi pod tym samym URL-em co powłoka — SW potrafi utrwalić stronę błędu jako app shell. Poprawne 200 z cockpitu niesie `Cache-Control: no-cache`.

## 2. Odczyt — co PWA pobiera

| Cel | Metoda i ścieżka | Odpowiedź (schemat) |
|---|---|---|
| Wersja, projekty, capabilities | `GET /api/v1/health` | `healthResponseSchema`: `version`, `projects[{id,name}]`, `bootProject`, `capabilities{…}`, `checks[]` |
| Lista zadań ze **wszystkich** projektów | `GET /api/v1/workspace/runs-index` | `runsIndexResponseSchema`: `runs: RunIndexEntry[]` (najnowsze pierwsze, max 200/projekt), `truncated[]` |
| Lista projektów | `GET /api/v1/projects` | rejestr projektów |
| Szczegóły zadania | `GET /api/v1/p/:projectId/runs/:id` | `ApiRun` (= `RunRecord` + pola API) |
| Transkrypt – strona historii (od końca) | `GET /api/v1/p/:projectId/runs/:id/history?cursor=` | `RunHistoryPage`: `events[]` (surowe linie ostatnich 100 *elementów*, nie 100 linii), `itemCount`, `olderCursor`, `newerCursor`, `liveCursor`, `asOfSeq`, `hasOlder` |
| Transkrypt – kontekst bieżący | `GET /api/v1/p/:projectId/runs/:id/history-context` | `RunHistoryContext`: `contextEvents[]` (najnowszy `plan.updated`, granice tur, otwarte elementy — gdziekolwiek leżą w pliku), `asOfSeq` |
| Diff zadania (tekst) | `GET /api/v1/p/:projectId/runs/:id/diff` | jeden blob `text/plain`; dla zadania bez worktree **200** ze zdaniem „(no worktree — …)” zamiast diffu — PWA tego nie używa |
| Zmienione pliki z poprawkami (S-09) | `GET /api/v1/p/:projectId/runs/:id/changes` | `ChangesPayload`: `files[]` (`ChangedFile`: `path`, `oldPath?`, `status`, `adds`, `dels`, `binary`, `image?`, `patch`), `stat`, `repointedHead?`; brak katalogu/błąd gita → **409** `{ error }` |
| Warianty zadania (S-21) | `GET /api/v1/p/:projectId/groups/:groupId` | `GroupResponse`: `{ groupId, runs[] }`, `runs` posortowane po literze; wiersz (`GroupVariant`): `id, variant, title, status, archived, tokensUsed, inputTokens?, outputTokens?, costUsd?, diffStat, handoffExcerpt`. **`diffStat` to tekst `git diff --stat`**, nie liczby z rekordu; `''` gdy worktree nie istnieje. Brak runów z tym `groupId` → **404** |
| Automatyzacje projektu (S-20) | `GET /api/v1/p/:projectId/automations` | `AutomationsResponse`: `available`, `reason?` (dostępność forge'a — nie 5xx), `scheduler{state,nextDue?}`, `timeZone`, `stats`, `automations[]` (`AutomationListEntry`: definicja + `enabled`, `kind` `schedule\|github`, `schedule?`/`events?`, `state?`, `latestLog?`, `counts`, `nextRunAt?` — brak, gdy wstrzymana, `lastRun?{runId,status,ts}`, `runs7d`). Cała rodzina odpowiada **409**, gdy `capabilities.automations` jest wyłączone |
| Dziennik automatyzacji (S-20) | `GET /api/v1/p/:projectId/automation-log` | `AutomationLogResponse`: `records[]` (najnowsze pierwsze, max 100; `seq, ts, automationId, result, reason?, runId?, githubNumber?, githubTitle?`), `runs{[runId]: {title,status,costUsd?,children[]}}` |
| Stan merge'a PR (S-19) | `GET /api/v1/p/:projectId/github/prs/:number/merge-state[?refresh=1]` | `GithubPrMergeStateResponse`, zawsze **200**: `{ available: false, reason }` (brak forge'a / `gh`) albo `{ available: true, mergeState }` (`githubPrMergeStateSchema`: `number, title, url, state` `open\|closed\|merged`, `isDraft, headRef, baseRef, headSha, mergeable, reviewDecision, checks[{name,state,required,url?}], methods[], defaultMethod, eligibility` `ready\|blocked\|pending\|unauthorized\|terminal\|unknown`, `blockers[{code,message}]`, `canMerge, canOverride`). Serwer trzyma go 15 s w cache; `refresh=1` pyta GitHuba od nowa. Numer PR jest względem repo **projektu** |
| Glify checków PR | `GET /api/v1/p/:projectId/github/checks?prs=1,2` | `GithubChecksData`: `{ available, checks{[number]: glyph} }` — jeden glif na PR; PWA go nie używa (stan merge'a niesie pełną listę checków) |
| Commity zadania | `GET /api/v1/p/:projectId/runs/:id/commits` | `{ commits: RunCommit[] }` |
| Notatki przekazania | `GET /api/v1/p/:projectId/runs/:id/handoff` | Markdown |
| Obrazek z transkryptu | `GET /api/v1/p/:projectId/runs/:id/images/:file` | bajty obrazu |
| Workflowy (do composera) | `GET /api/v1/p/:projectId/workflows` | `workflowsResponseSchema`: `workflows[]` (`name`, `description?`, `steps[]`, `source`), `issues[]` (pliki, których nie dało się wczytać) |
| Ustawienia agenta projektu | `GET /api/v1/p/:projectId/config` | `configResponseSchema`: `defaultRunner`, `defaultModels{claude?,codex?,…}`, `modelsLocked`, … |
| Modele runnera | `GET /api/v1/models?runner=claude\|codex\|opencode` | `runnerModelCatalogResponseSchema`: `models[{id,label,description}]`, `source` (`live\|cache\|unavailable`), `stale`. Trasa **workspace'owa** — `GET /api/v1/p/:projectId/models` zwraca **404** (sprawdzone na `0.11.0`, 2026-09-24). `pi` nie ma katalogu (400) |
| Konta agentów | `GET /api/v1/workspace/agent-profiles` | `agentProfilesResponseSchema`: `profiles[]` (`id`, `provider`, `label`), `selections`, `defaults`; na tym hoście (`CEZ_REMOTE`) `profiles: []` |

### RunStatus
`queued | running | waiting | review | done | failed | cancelled`
plus `activity: 'monitoring'` (podstan `running` — agent czeka na własną pracę w tle, **nie** wymaga uwagi) oraz `autoResumeAt` (zadanie `failed` przez limit dostawcy, wznowi się samo → traktuj jak „zaplanowane”, nie jak błąd).

### Lista zadań w PWA (S-03) — jak czytamy `runs-index`
- Jedno zapytanie `GET /api/v1/workspace/runs-index` (trasa workspace — nie ma wariantu `/p/:projectId/`), klucz `['runs-index']`. Nazwy projektów z `GET /api/v1/health` → `projects[]` (już w cache po sondzie sesji).
- Odpowiedź **nie jest** walidowana schematem zod w runtime: enumy kontraktu są zamknięte, a słownik rośnie. Sprawdzamy tylko, że `runs` jest tablicą — inaczej błąd, nigdy pusta lista („nic nie czeka” byłoby nieprawdą). Schematy walidują fixture'y w testach (`apps/pwa/test/contract/`).
- Sekcje PRD (FR-008): Wymaga uwagi / W toku / W kolejce (+ zaplanowane wznowienia) / Zakończone; zarchiwizowane ukryte. Kolejność w sekcji = `sortRuns` z `web/src/lib/task-groups.ts`. Numer w kolejce liczony dla całego workspace'u (semafor `maxParallel` jest wspólny dla projektów).
- Odświeżanie: przy powrocie na pierwszy plan (`refetchOnWindowFocus: 'always'`), przyciskiem i gestem „pociągnij”; na żywo ze strumienia workspace (S-04, § 3a), z pollingiem co 30 s, gdy strumień nie działa, i co 5 min, gdy działa. 401/403 → ponowna sonda `health` → ekran „Połącz z Cezarem”.
- `runs-index` **nie niesie** `pinned` ani `groupId` — lista PWA nie ma więc sekcji „Przypięte” ani zwijania wariantów. Warianty widać dopiero na ekranie zadania (S-21): z `groupId` rekordu.

### Kluczowe pola `RunIndexEntry` (lista)
`projectId, id, title, titleSummary, status, activity, createdAt, startedAt, finishedAt, seenAt, archived, autoResumeAt, workflow, branch, pullRequestUrl, prNumber, issueNumber, costUsd, peakRssBytes, usage{cpu,rss…}`

### Dodatkowe pola `RunRecord` (szczegóły)
`task, steps[{id,name,kind:'agent'|'check',status,…}], currentStepId, diffStat, model, runner, autonomous, queuedMessages[], tokensUsed, inputTokens, outputTokens, error, worktreePath, groupId, variant, pinned`

### Ekran zadania w PWA (S-05) — jak czytamy rekord i transkrypt
- Trzy odczyty równolegle: rekord (`['run', projectId, runId]`), najnowsza strona historii bez kursora (`['history', projectId, runId]`) i kontekst (`['history', projectId, runId, 'context']`). Od S-06 ekran jest na żywo ze strumienia zadania (§ 3b); gdy strumień nie działa — odświeżanie jak listy przed S-04: przy powrocie na pierwszy plan, co 30 s gdy widoczny, przyciskiem; bez cichych ponowień. Odpowiedź starsza niż 60 s w trakcie odświeżania jest przygaszona (guardrail: nieaktualny stan nigdy nie udaje bieżącego).
- **Strona historii to surowy plik, nie sam protokół v2.** Zdarzenia v2 (`item.*`, `turn.*`, `plan.updated`) leżą przemieszane ze swoimi bliźniakami v1 (`text`, `tool-call`, `tool-result`) i z liniami tylko-v1 (`user-message` — wiadomości operatora istnieją **wyłącznie** w v1 — `note`, `lifecycle`, `check-output`, `image`, nieudany `step-end`). Zmierzone na żywej stronie: każde wywołanie narzędzia jest w pliku dwa razy. Stąd `apps/pwa/src/domain/transcript.ts` to port `reduceThread()` z `web/src/routes/task-thread/thread-state.ts` razem z regułami deduplikacji (w obrębie tury v2 wygrywa dla narzędzi; proza v1 znika tylko wtedy, gdy wiadomość v2 tej samej tury ma ten sam tekst).
- `item.delta` **nie występuje** w historii (delty są efemeryczne, tylko w strumieniu na żywo). Reducer i tak je obsługuje — S-06 dokłada zdarzenia ze strumienia (§ 3b) do tego samego złożenia.
- Przewijanie (FR-019, S-06): ekran podąża za nową treścią tylko, gdy czytelnik jest ≤ 96 px od końca; wyżej zostaje na miejscu i pokazuje przycisk „Nowe wiadomości”. „Na końcu” liczone synchronicznie względem wysokości treści sprzed zmiany — WebKit wysyła `scroll` dopiero z następną klatką.
- Nieznany `type`, `item.*` z nieznanym `kind` albo bez `id` — pominięte, nic nie rzuca (reguła 5; PRD dopuszcza „renderuje ogólnie albo pomija”).
- **Plan przypięty nad transkryptem** składany jest z kontekstu ∪ strony (odpowiednik `currentEvents` z cockpitu), bo najnowszy `plan.updated` może leżeć przed pierwszą linią strony. Treść transkryptu — tylko ze strony. Błąd kontekstu nie psuje ekranu (plan wtedy tylko ze strony).
- Gdy `hasOlder`, na górze transkryptu jest odnośnik do cockpitu — starsze strony (FR-049) są odłożone.
- Obrazy z transkryptu nie są ładowane: linia v1 `image` niesie URL z zamrożonej powierzchni `/api/runs/…` (reguła 2). Obrazy w Markdownie agenta też nie — renderujemy tekst alternatywny (żadnych żądań do stron trzecich).
- **Przeczytane (FR-020):** `POST …/runs/:id/read` wysyłane raz, tylko gdy `isUnread(run)`. Odpowiedź to cały rekord, ale do cache'u (`['run', …]` i wiersz w `['runs-index']`) trafia **wyłącznie** `seenAt` — tak jak `useMarkRunSeen` w cockpicie (migawka sprzed lotu cofnęłaby pola, które w międzyczasie się zmieniły).
- Ścieżka ekranu: `/m/p/:projectId/runs/:runId` — tę samą otwiera powiadomienie (S-10, `apps/pwa/src/pwa/push-message.ts`). Router ma `basename="/m/"` **ze slashem**: z `/m` link do listy prowadzi pod `/m`, poza scope service workera i poza `location ^~ /m/` w nginx.

### Diff zadania w PWA (S-09) — jak czytamy `/changes`
- Ekran `/m/p/:projectId/runs/:runId/diff`, otwierany wierszem „Zmiany” w nagłówku zadania (liczby z `run.diffStat`, gdy rekord je ma — pojawia się dopiero po pierwszej skończonej turze, więc wiersz jest zawsze, najwyżej z „Pokaż zmiany”). Klucz `['changes', projectId, runId]`.
- **`/changes`, nie `/diff`.** `/changes` to strukturalny odpowiednik z tą samą bazą co zakładka Changes cockpitu (`resolveTaskDiffBase`: merge-base z najświeższym ref bazy; dla worktree przepiętego na inną gałąź — tylko to, co zadanie tam zmieniło, plus `repointedHead`). `/diff` odpowiada tekstem i dla zadania bez worktree zwraca **200** z komunikatem — telefon wziąłby go za diff. Zmierzone na żywo: zadanie z przepiętym worktree odpowiada `{ files: [], stat: 0, repointedHead: { headBranch: 'HEAD', taskBranch: 'cez/…' } }` (`test/fixtures/changes-repointed.live-0.11.0.json`).
- `patch` to sekcja `git diff` jednego pliku (`diff --git` + nagłówki + hunki), ucięta przez serwer po 200 000 znaków z dopiskiem `… (patch truncated)`. Parser (`apps/pwa/src/domain/diff.ts`) to port `parse-patch.ts` z cockpitu bez tego, czego telefon nie pokazuje (widok split, znaczniki słów, rozwijany kontekst).
- `binary` / `image` → jedna linia tekstu; obrazów nie ładujemy (reguła z S-05). Pusty `patch` bez binarności (czysta zmiana nazwy lub uprawnień) → „Bez zmian w treści”.
- Walidacja w runtime jak wszędzie: `files` musi być tablicą, inaczej błąd (nigdy „brak zmian”); plik bez `path`/`patch` wypada sam; nieznany `status` → „zmieniony” (reguła 5). `stat` liczony z wierszy, żeby nagłówek zgadzał się z listą.
- Odświeżanie: przy powrocie do aplikacji; co 30 s tylko, gdy zadanie jest aktywne (`isRunActive`); bez cichych ponowień. Timeout 15 s (duże odpowiedzi).

## 3. Strumienie na żywo (SSE)

Wszystkie wysyłają `ping` co kilkanaście sekund. Nagłówki anty-buforujące są ustawiane przez serwer; nginx musi mieć `proxy_buffering off` (instalator Cezara już to robi).

### 3a. `GET /api/v1/workspace/events` — cały workspace (ekran listy)
Trasa workspace (bez wariantu `/p/:projectId/`, jak `runs-index`). Kształty ramek odczytane z `server/server.js` @ `v0.11.0` i złapane na żywo po loopbacku (2026-09-21) — **stempel projektu to `project`, nie `projectId`**:

| event | data |
|---|---|
| `run` | pełny `RunRecord` po każdej zmianie + `project` (`{ ...run, project }`) |
| `run-deleted` | `{ id, project }` |
| `todos` | `{ project, items }` (tylko przy `CEZ_FOLLOWUPS=1`) |
| `usage` | `{ project, usage: { [runId]: { cpuPct, rssBytes, procCount } } }` — co ~2 s, tylko gdy jakiś run ma żywy proces; projekt bez żywych wierszy nie dostaje ramki |
| `project-added` / `project-removed` | wpis projektu (`project-removed` niesie `id`) |
| `provider-status` | stan logowania agentów (bez stempla, host-wide) |
| `checkout-progress` | postęp klonowania |
| `ping` | pusty, **co 15 s** |

Nie ma linii `id:` — **przy reconnect nie ma replay**, po wznowieniu **zawsze** refetch `runs-index`. Nagłówki: `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Strumień podpina projekty, których kontekst serwer już zbudował, i dopina kolejne, gdy powstają (`onContextBuilt`).

**Jak korzysta z tego PWA (S-04, `apps/pwa/src/api/workspace-events.ts`):**
- Jedno `EventSource` na ekran listy. Nasłuch tylko na nazwane zdarzenia, których używamy (`run`, `run-deleted`, `project-added`, `project-removed`, `usage`, `ping`) — nowe nazwy upstreamu po prostu nie docierają (reguła 5).
- `run` → wiersz przez `toIndexEntry()` (kopia `runIndexEntry()` z `server.js`), upsert do `['runs-index']` przez `setQueryData`; `run-deleted` → usunięcie. Nieczytelna ramka jest pomijana, nie rzuca. `usage` liczy się tylko jako oznaka życia (wiersz nie pokazuje CPU/RSS).
- Ramki, które przyjdą, gdy `runs-index` jest w drodze, są odtwarzane na jego odpowiedzi (`FrameJournal`) — inaczej wolny refetch nadpisałby nowszy status starszym.
- Stan połączenia: `connecting | live | reconnecting | lost`. Własny backoff (1, 2, 5, 10, 30 s) zamiast przeglądarkowego, watchdog 45 s (trzy zgubione pingi albo połączenie, które nigdy się nie otworzyło), `lost` po 20 s bez połączenia albo od razu przy `offline`. Każde otwarcie → refetch `runs-index`; każde zerwanie → ponowna sonda `health` (EventSource nie pokazuje kodu HTTP, a wygasła sesja to goły 403).
- Strumień zamykany przy `visibilitychange → hidden`, otwierany na nowo przy `visible` (iOS zamraża aplikację).
- Lista jest „na żywo” dopiero, gdy strumień jest otwarty **i** po otwarciu dotarł refetch; wcześniej pokazuje „lista z HH:MM”. Polling: 30 s, gdy nie jest na żywo; 5 min jako siatka bezpieczeństwa, gdy jest.

**Jak korzysta z tego sidecar `cezar-push` (S-10, `apps/push-sidecar/src/watcher.ts`):**
- Po loopbacku (`http://127.0.0.1:4322` — port żywej instancji, `cezar-cli serve --port 4322`), bez ciasteczka bramy. Node 20 nie ma `EventSource`, więc strumień czytany jest przez `fetch` (`sse.ts`). Tylko odczyty: `workspace/events`, `workspace/runs-index`, `health` (nazwy projektów).
- Po każdym otwarciu: `runs-index` staje się **bazą** i nic z niej nie jest ogłaszane — zadanie, które czekało przed restartem sidecara albo przed zerwaniem strumienia, nie dzwoni. Ramki, które przyjdą, zanim baza dotrze, uzupełniają ją po cichu (nie da się stwierdzić, czy są starsze od odpowiedzi; zgubione powiadomienie jest mniejszym złem niż fałszywe).
- `run` → `isEntering(before, run)` z `packages/shared/src/notifications.ts` (port `diffRunTransitions()` z `web/src/lib/notifications.ts`, kluczowany projektem + id). `run-deleted` → zapomnienie. `project-added` → odświeżenie nazw. Reszta ignorowana (reguła 5).
- Backoff i watchdog jak w PWA (1, 2, 5, 10, 30 s; 45 s bez bajtu). W pamięci trzyma tylko statusy; nie loguje tytułów ani treści.

### 3b. `GET /api/v1/p/:projectId/runs/:id/events` — jedno zadanie (ekran szczegółów)
Odczytane z `server/server.js` i `runs/ui-event-sink.js` @ `v0.11.0`:
- Parametry wznowienia: `?cursor=<liveCursor>` (z `/history` — offset w pliku, serwer czyta tylko ogon) i `?afterSeq=<n>`; nagłówek `Last-Event-ID` działa jak `afterSeq`. Serwer odtwarza każdą **utrwaloną** linię z `seq > max(afterSeq, granica kursora)`, potem przechodzi na żywo. Kursor nieważny (plik się skrócił) → `409` jeszcze przed strumieniem.
- Każda ramka zdarzenia ma `id: <seq>`.
- event `ui-event` — linia protokołu v2 (typ z kropką), utrwalona **albo** efemeryczna
- event `run-event` — linia v1 (bez kropki). Strona historii ma obie, więc słuchamy obu.
- event `run` — cały `RunRecord` po każdej zmianie i raz po zakończeniu replayu
- event `ping` — co 15 s
- **`item.delta` nigdy nie trafia do pliku.** Delty są scalane co ~40 ms i idą tylko na żywo, z własnym `seq` — replay ich nie odtworzy. `item.updated` z samym przyrostem treści też bywa tylko na żywo. `item.completed` zawsze niesie stan końcowy.

**Jak korzysta z tego PWA (S-06, `apps/pwa/src/features/run/useLiveTranscript.ts`):**
- Strumień startuje, gdy jest pierwsza strona historii: `cursor=page.liveCursor`, `afterSeq=page.asOfSeq` — tak samo łączy się cockpit.
- Linie trafiają do `['history', projectId, runId]` przez `setQueryData` (`appendLiveEvent` w `src/domain/live-transcript.ts`). `asOfSeq` strony to znacznik: rośnie z każdą linią, linia z `seq <= asOfSeq` jest odrzucana (**nic dwa razy** — liczy się dla linii v1, które nie mają id). Każde połączenie prosi o `afterSeq = asOfSeq` (**nic nie ginie**).
- Delta trafia tylko do elementu, którego ostatni snapshot przyszedł **po** starcie bieżącego połączenia. Element złapany w połowie przez zamrożenie zostaje z tekstem sprzed przerwy, aż dojdzie jego snapshot — nigdy nie jest sklejany z dziurą w środku. Kolejne delty tego samego elementu i pola scalają się w jedną linię, a snapshot usuwa delty swojego elementu.
- `run` → `['run', …]` (scalone, zachowuje pola tylko-API jak `usage`) i wiersz w `['runs-index']`.
- Stan i cykl życia jak w § 3a (wspólne `src/api/live-stream.ts`): backoff, watchdog, zamknięcie przy `hidden`, ponowne otwarcie przy `visible` — to jest wznowienie po zamrożeniu przez iOS. Zerwanie → sonda `health`. Próba, która się nie otworzyła → następna **bez** kursora (409 wyglądałby jak każdy inny błąd, w nieskończoność).
- Na żywo: rekord odpytywany co 5 min jako siatka, strona i kontekst wcale (replay je pokrywa). Bez strumienia: jak w S-05 (30 s, przy powrocie). Refetch strony, który wyląduje w trakcie, dostaje z powrotem linie nowsze od siebie (`carryOver`).

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
| Anuluj | `POST …/runs/:id/cancel` | — → `{ cancelled: boolean }` (`false` = zadanie już się zakończyło, też 200) |
| Kontynuuj (zakończony run) | `POST …/runs/:id/continue` | — lub `{ text?, runner?, model? }` → `{ continued: true }`; odmowa silnika = 409 |
| Zakończ / zaakceptuj review | `POST …/runs/:id/finish` | — → `{ finished: true }`; `409 no open session` |
| Draft PR | `POST …/runs/:id/pr` → 201 | — → `{ url, dryRun }`; 400 bez worktree, 409 `{ error, manual }` (błąd forge'a albo run aktywny) |
| Oznacz jako przeczytane / nieprzeczytane | `POST …/runs/:id/read` / `…/unread` | — |
| Przypnij / odepnij | `POST …/runs/:id/pin` | `{}` lub `{ pinned:false }` → cały rekord |
| Archiwizuj / przywróć | `POST …/runs/:id/archive` | `{}` lub `{ archived:false }` → cały rekord (archiwizacja zdejmuje też pin i zaplanowane wznowienie) |
| Anuluj auto-wznowienie | `DELETE …/runs/:id/auto-resume` | — |
| Zostaw ten wariant | `POST /api/v1/p/:projectId/groups/:groupId/pick` | `{ runId }` → `{ winner? }` (cały rekord; klucz może zniknąć, gdy store go nie znajdzie). Pozostałe warianty: anulowane, jeśli żyją, zarchiwizowane, worktree i gałąź usunięte. **409** `this variant is still active — wait for it to finish first`; **404** `not found` (brak grupy) / `runId is not part of this group` |
| Wstrzymaj / włącz automatyzację | `POST /api/v1/p/:projectId/automations/:id/pause` / `…/enable` | — → `{ automation }`. Włączenie ustawia bazę „od teraz” (poll GitHuba nie odpali zaległości z okna `lookbackDays`). **404** `not found` |
| Uruchom automatyzację teraz | `POST /api/v1/p/:projectId/automations/:id/run` → 202 | — → `{ runId }`. **Tylko `kind: schedule`**, niezależnie od `enabled`; nie rusza `nextRunAt`. **409**: `a GitHub automation is run through check with mode execute`, `this instant was already launched`, `automation polling lease is held by another process`, `the launch failed — see the execution log` |
| Merge PR (S-19) | `POST /api/v1/p/:projectId/github/prs/:number/merge` | `{ method: 'merge'\|'squash'\|'rebase', expectedHeadSha: <40 hex>, overrideRules?: boolean }` (`.strict()`) → `{ merged: true, number, url, method, mergeCommitSha? }`. Serwer najpierw czyta stan od nowa (`refresh`) i odmawia: **409** `The pull request head changed…` (`code: stale-head`), `That merge method is no longer enabled.` (`disabled-method`), pierwszy `blocker` (kod = `eligibility`), `A merge is already in progress.` (`concurrent`), `GitHub refused the merge.` (`github-blocked`); `409 GitHub merge is unavailable` bez forge'a; **403** `GitHub permission denied.`, **404**, **502** (`reason` z odczytu stanu). `overrideRules: true` przechodzi tylko przy `canOverride` |

### Odpowiedź agentowi i wiadomość w PWA (S-07) — jak piszemy
- **Odpowiedź `/messages`** to jedna z trzech: `{ delivered: true }` (żywa sesja ją przyjęła), `{ queued: true, message }` (zadanie w kolejce — dopisane do polecenia, widoczne w `queuedMessages[]` rekordu, nie w historii), `{ deferred: true }` (sesja startuje — wiadomość czeka na jej otwarcie). Wszystko inne to `409`, np. `session closed` albo powód z bramki providera.
- **Trasa jak w cockpicie (`ask-answer.ts`, `v0.11.0`):** zadanie aktywne (`running`/`waiting`/`queued`) → `POST …/messages { text }`. Zadanie zamknięte z zapisaną sesją (`steps[].sessionId`) → `POST …/continue { text }` — tekst staje się poleceniem otwierającym wznowioną sesję (bez `runner`/`model`, więc silnik zostaje ten sam). `409` z `/messages` przy zapisanej sesji = nieaktualny rekord → ta sama odpowiedź idzie przez `/continue`, zamiast przepaść. Gdy i to się nie uda, operator widzi powód odmowy `/messages`, nie powód próby zastępczej. Jedyne ponawianie: `409 run is still active` z `/continue` (sesja domyka się po timeoucie bezczynności), wg harmonogramu cockpitu, łącznie ok. 6 s. **Odwrotny kierunek (Cezar #986, `deliver-prompt.ts` @ `v0.11.1`):** rekord mówi „zakończone”, a zadanie wciąż działa → `/continue` odpowiada `409`. Wtedy rekord jest pobierany raz jeszcze z pominięciem cache (`staleTime: 0`); jeśli świeży rekord mówi, że sesja żyje, tekst idzie przez `POST …/messages` (i cache przestaje kłamać). Jeśli świeży rekord zgadza się z próbowaną trasą, operator widzi odmowę `/continue` bez zmian.
- **Format odpowiedzi na pytanie** (`ask.requested`): `"<header>: <etykiety, po przecinku>"`, kilka pytań = jedna wiadomość, linia na pytanie. Reducer rozwiązuje kartę przy **następnym** `user-message`, więc odpowiedź własnymi słowami (dowolna wiadomość) też ją zamyka. Interaktywne jest tylko najnowsze pytanie — starsze nierozwiązane nie może się już rozwiązać.
- Kompozytor jest tylko dla zadań aktywnych oraz dla zamkniętych z otwartym pytaniem; zwykłe „kontynuuj” to S-08. Zapis ma timeout 20 s i **nie jest ponawiany**: po timeoucie wiadomość mogła dotrzeć, więc operator dostaje to zdanie zamiast drugiej wysyłki. Szkic zostaje w polu, dopóki Cezar go nie przyjmie.
- Po każdej próbie (udanej i nie) unieważniamy `['run', …]`, `['history', …]` (z kontekstem) i `['runs-index']`.

### Nowe zadanie w PWA (S-13, FR-033/034) — jak tworzymy
- **Formularz:** projekt, opis (`task`), `workflow`, `runner`, `model`, `agentProfile`, `autonomous`. `variants`, `dispatch`, `steps`, `images`, `systemPrompt`, `issueNumber` zostają w cockpicie (#62). Body bez niewybranych kluczy (brak `model` = „Auto”, runner wybiera sam); `autonomous` wysyłane zawsze.
- **Domyślne wybory jak w cockpicie:** workflow `quick-task` (albo pierwszy z listy), runner = `config.defaultRunner` projektu, jeśli zainstalowany, dalej `health.defaultRunner`, dalej pierwszy dostępny. Zainstalowane runnery = `health.checks[]` z `available: true` (bez `gh`/`git`); na tym hoście tylko `claude`. Model = `config.defaultModels[runner]`, jeśli jest w katalogu; przy `modelsLocked` pola modelu nie ma. Picker kont tylko, gdy `agent-profiles` ma konta dla tego runnera.
- **Odpowiedź 201 to unia** (`createRunResponseSchema`): rekord (`id`) albo `{ runs: [...] }` — otwieramy pierwszy. Nawigacja z `replace` na `/m/p/:projectId/runs/:id` (wstecz = lista, nie wysłany formularz). Po sukcesie unieważniamy `['runs-index']`.
- **Odmowa** (np. `400 unknown workflow: …`) → `{error}` dosłownie (FR-032), opis zostaje w polu. Timeout 20 s, bez ponowień: zadanie mogło powstać, więc operator dostaje prośbę o sprawdzenie listy.

### Akcje na zadaniu w PWA (S-08) — kiedy którą pokazujemy
- **Polityka = kopia `runActionFlags()`** z `web/src/routes/task-thread/run-actions.ts` @ `v0.11.0` → `apps/pwa/src/domain/run-actions.ts`. „Aktywne” = `running | queued | waiting` (`review` **nie** jest aktywne). Anuluj: aktywne. Zakończ: `waiting` (zamyka sesję) albo `review` (akceptuje zmiany bez PR — ten sam endpoint, inna etykieta). Kontynuuj: nieaktywne **i** zapisana sesja (`steps[].sessionId`). Archiwizuj/przywróć: nieaktywne. Przypnij/odepnij: niezarchiwizowane.
- **Draft PR** — jak panel przeglądu cockpitu (`review-panel.tsx`): tylko przy `review` i tylko, gdy `pullRequestUrl` nie jest linkiem http(s) (drugi tap otworzyłby duplikat). Po sukcesie serwer ustawia `pullRequestUrl` i kończy run jako `done`. Komendy `manual` z odpowiedzi 409 nie pokazujemy — na telefonie `git merge` nic nie da; pokazujemy powód.
- **Anuluj** tylko po potwierdzeniu (FR-025). `{ cancelled: false }` → komunikat „zdążyło się zakończyć”, nie sukces.
- **Kontynuuj** bez body: serwer wznawia sesję na silniku runu (bez `runner`/`model`).
- Jedna akcja naraz; pasek czeka też na wysyłkę z S-07. Timeout 20 s, bez ponowień (akcja mogła się wykonać). Powód odmowy dosłownie (FR-032). Po każdej próbie unieważniamy `['run', …]`, `['history', …]` i `['runs-index']`; odpowiedź pin/archive trafia do cache'u **tylko jako flaga** (jak `seenAt` przy `/read`), `archived` także do wiersza listy — lista chowa zarchiwizowane od razu.

Akcja na `permission.requested`: mechanizm odpowiedzi do potwierdzenia w `packages/web/src/routes/task-thread/` przed implementacją (domyślnie Cezar działa z `dontAsk`, więc prośby o uprawnienia pojawiają się tylko przy `CEZ_APPROVAL_GATE=1`).

### Warianty zadania w PWA (S-21, #71) — lista i „Zostaw ten”
- Zadanie uruchomione ×2/×3 to kilka runów z tym samym `groupId` (litera w `variant`). `runs-index` go nie niesie, więc panel „Variants” pojawia się na ekranie zadania, gdy **rekord** ma `groupId`, i czyta `GET …/groups/:groupId` (klucz `['group', projectId, groupId]`, timeout 15 s jak `/changes`, bo serwer liczy `git diff --stat` w każdym worktree). Co 30 s, dopóki któryś wariant jest aktywny; potem tylko przy powrocie na pierwszy plan — oraz od razu, gdy zmieni się status lub archiwizacja bieżącego zadania (jego rekord jest na żywo ze strumienia).
- Wiersz: litera, status (jak na liście), liczba zmienionych plików z ostatniej linii `diffStat` (`N files changed`; `''` = „nieznane”, nie zero) i koszt. Wiersz rodzeństwa otwiera jego ekran zadania. Porównywanie diffów obok siebie zostaje w cockpicie (N07).
- „Keep this one” tylko po potwierdzeniu i tylko gdy: bieżący wariant nie jest zarchiwizowany i co najmniej jeden inny wariant nie jest zarchiwizowany (inaczej grupa jest już rozstrzygnięta). Wariant aktywny (`running | queued | waiting`) pokazuje zamiast przycisku zdanie „można go zostawić po zakończeniu” — serwer i tak odpowiedziałby 409.
- Timeout 20 s, bez ponowień (wybór mógł już zarchiwizować resztę). Odmowa dosłownie (FR-032). Po każdej próbie unieważniamy grupę, wszystkie `['run', projectId, …]` (przegrani zostali zarchiwizowani), historię i `['runs-index']`. Pasek akcji S-08 i panel czekają na siebie nawzajem.
- Na hoście nie ma dziś żadnej grupy (0 z 41 runów w indeksie z `groupId`, stan 2026-09-24), więc fixture `apps/pwa/test/fixtures/group.json` jest ręczny, walidowany schematem `groupResponseSchema`.

### Automatyzacje w PWA (S-20, #70) — tylko reagowanie
- Ekran `/m/automations?project=…`, link z listy zadań tylko przy `health.capabilities.automations === true` (przy wyłączonym ekran mówi to wprost i nic nie pyta — rodzina odpowiedziałaby 409). Tworzenie, edycja, usuwanie i podgląd `/check` zostają w cockpicie (N05, PRD Non-Goals po zawężeniu D07 z 2026-09-24).
- Wiersz: nazwa, `Enabled`/`Paused`, wyzwalacz (harmonogram słowami z domyślnymi wartościami kontraktu — godzina jest w `timeZone` serwera, na hoście `UTC`, więc gdy zegar telefonu się różni, dopisujemy strefę: `Every day at 04:00 (UTC)`, bo „Next …” jest już w czasie telefonu — albo zdarzenia GitHuba), ostatnie uruchomienie (`lastRun`, dalej `state.lastRunAt`) z linkiem do zadania, następne (`nextRunAt`, tylko gdy włączona). `available: false` → notka z `reason` serwera dosłownie; lista zostaje (harmonogramy działają bez GitHuba).
- **Run now tylko dla `kind: schedule`** — poll GitHuba serwer odrzuca (`409`, uruchamia się go przez `/check`, poza zakresem). Run now jest za potwierdzeniem (brief R03: uruchamia zadanie). Pause/Enable bez potwierdzenia.
- Jedna akcja naraz na cały ekran, timeout 20 s, bez ponowień (Run now po timeoucie mógł już uruchomić zadanie). Odmowa dosłownie (FR-032). Po każdej próbie unieważniamy `['automations', projectId]` i `['automation-log', projectId]`, po Run now także `['runs-index']`; sukces Run now linkuje do nowego zadania.
- Nic nie strumieniuje zmian automatyzacji do PWA: lista i dziennik odświeżają się co 30 s i przy powrocie na pierwszy plan. Dziennik pokazuje 10 najnowszych wpisów, resztę (do 100) na żądanie.
- Na hoście (`0.11.1`, 2026-09-24) oba projekty mają `automations: []`, więc fixture'y `automation{s,-log}.json` są ręczne, walidowane schematami kontraktu.

### Merge PR w PWA (S-19, #69) — stan, checki i merge za potwierdzeniem
- Panel „Pull request #N” pod akcjami zadania, gdy nagłówek ma link do PR z numerem (`prLink()`: PR utworzony przez zadanie, dalej PR, którego zadanie dotyczy). Czyta `GET …/github/prs/:number/merge-state` (klucz `['merge-state', projectId, number]`) co 30 s i przy powrocie na pierwszy plan; PR scalony lub zamknięty nie jest już odpytywany. Trasa jest względem repo projektu, więc gdy `mergeState.url` nie wskazuje tego samego PR co link zadania (inne repo, ten sam numer), panel mówi to wprost i nie oferuje merge'a.
- Nagłówek panelu i kolejność checków (`failing → pending → unknown → passing`) to `apps/pwa/src/domain/merge.ts`. Stan każdego checka jest słowem obok glifu, nie tylko kolorem. Powody blokady to `blockers[].message` serwera, dosłownie, w jego kolejności. `available: false` → „The merge state is unavailable:” + `reason` dosłownie.
- **Merge oferujemy dokładnie wtedy, gdy serwer by go przyjął** (`mergeGate()`): `canMerge`, albo `canOverride` po zaznaczeniu „Merge without waiting for requirements” (wtedy body ma `overrideRules: true`) — jak `GithubMergeBox` w cockpicie (`web/src/routes/github/github.tsx`). Na tym hoście prywatne repo nie pokazuje reguł ochrony gałęzi (`required: null`, `reviewDecision: unknown`), więc otwarty PR zwykle ma `eligibility: unknown` i `canMerge: false` — bez obejścia nie dałoby się go scalić ani z cockpitu, ani z telefonu.
- Merge za potwierdzeniem z numerem i tytułem PR oraz gałęzią docelową (brief R03); tam wybór metody spośród `methods` (domyślnie `defaultMethod`). Body niesie `expectedHeadSha` = `headSha` z pokazanego stanu: push w międzyczasie serwer odrzuca (`stale-head`) zamiast scalić niewidziane commity.
- **Nigdy optymistycznie.** Po każdej próbie (sukces, odmowa, timeout) stan jest czytany od nowa z `refresh=1` i to on jest pokazywany; unieważniamy też `['run', …]`, historię i `['runs-index']`. Timeout 20 s, bez ponowień (merge mógł się wykonać). Odmowa dosłownie (FR-032). Konwersja draft → ready, pliki, recenzje i komentarze zostają na GitHubie (N06).
- Fixture'y: `merge-state.live-0.11.1.json` (scalony PR #78 tego repo, z hosta) i ręczny `merge-state.json` (otwarty, jeden check failing, jeden pending), walidowane `githubPrMergeStateResponseSchema`.

## 5. „Wymaga uwagi” — reguła powiadomień

Kopia 1:1 `deriveAttention()` z `packages/web/src/lib/attention.ts` @ `v0.11.1` → `packages/shared/src/attention.ts` (uzgodniona ze źródłem 2026-09-21, ponownie porównana 2026-09-24 — plik identyczny z `v0.11.0`, razem z testami tablicowymi upstreamu). Cezar #995 (tura czekająca tylko na własne subagenty nie jest już „needs you”) jest poprawką po stronie serwera (`workflows/run.ts`): taka tura parkuje jako `status: 'running', activity: 'monitoring'` zamiast `status: 'waiting'`, więc ta sama reguła — w PWA i w sidecarze — przestaje ją pokazywać i pushować bez zmiany kodu tutaj. Zwraca `{ bucket, tone, pulse, label }`, first-match-wins:
1. oczekujące `permission.requested` → `permission` — **na sztywno `false` także upstream, gałąź nieosiągalna, patrz 5a**
2. `failed` + `autoResumeAt` → `none` / „scheduled” — **bez** uwagi
3. `failed` → `error`
4. `waiting` → `waiting` / „needs you”
5. `review` → `waiting` / „needs review”
6. `running` + `activity: 'monitoring'` → `running` / „monitoring” — bez uwagi
7. `running` → `running`; `queued`, `done`, reszta → `none` (**ostatni szczebel to catch-all z etykietą „cancelled”** — PWA pokazuje nieznany status jako jego surową nazwę, nie jako „anulowane”)

„Wymaga uwagi” = `wantsAttention()` = kubełki `permission | error | waiting` (czyli `waiting`, `review`, `failed` bez `autoResumeAt`). To predykat powiadomień w cockpicie i **ta sama** odpowiedź dla górnej sekcji listy PWA i odznaki (PRD, Business Logic). Uwaga: pasek boczny cockpitu ma węższy kubełek „Needs you” (tylko `waiting`/`review`; `failed` ląduje w „Recent”) — PRD świadomie idzie za regułą powiadomień, nie za paskiem bocznym.

Przeczytane/nieprzeczytane (znacznik w wierszu) to osobny kanał: kopia `web/src/lib/read-state.ts` → `packages/shared/src/read-state.ts` (`isUnread`: `done`/`failed`, nie zarchiwizowane, nie zaplanowane, `seenAt < finishedAt`).

Powiadamiamy przy **wejściu** zadania w stan wymagający uwagi (przejście, nie stan), tak jak `web/src/lib/notifications.ts`. Od S-10 to kod: `isEntering()` w `packages/shared/src/notifications.ts` — pierwsze zobaczenie i niezmieniony status nigdy nie dzwonią; zmiana między dwoma stanami uwagi (`waiting` → `failed`) dzwoni.

### 5b. Powiadomienie — co niesie (S-10)
Sidecar wysyła strukturę, nie tekst (`PushPayload`): `{ kind: 'attention', projectId, projectName, runId, title, reason }`, gdzie `title` = pierwsza linia `titleSummary ?? title`, ucięta do 100 znaków, a `reason` = `deriveAttention().label`. Słowa składa service worker z `i18n/en.ts` („Waiting for your answer”, „Waiting for review”, „Ended with an error”). Bez kodu, bez treści transkryptu (FR-043). `tag` per zadanie — nowsze powiadomienie o tym samym zadaniu zastępuje starsze. Tap → `/m/p/:projectId/runs/:runId`; otwarte okno aplikacji dostaje `postMessage` i przechodzi tam w miejscu, bez przeładowania (FR-041). Endpointy sidecara: `apps/push-sidecar/README.md`.

### 5a. `permission.requested` jest martwym typem (zweryfikowane 2026-09-20)

Gałąź 1 nigdy się nie wykona na tej instancji. Trzy warstwy dowodu:

1. **Przełącznik nie jest ustawiony.** `CEZ_APPROVAL_GATE` czytany w `dist/core/claude-cli-runner.js:322` (`env.CEZ_APPROVAL_GATE === '1' ? 'acceptEdits' : 'dontAsk'`). Żywy proces ma z cezarowych zmiennych tylko `CEZ_REMOTE=1`; unit deklaruje `CEZ_REMOTE` i `PATH`. Runner startuje z `--permission-mode dontAsk`.
2. **`dontAsk` z definicji nie generuje promptów.** Narzędzia z `--allowedTools` przechodzą, reszta jest odrzucana zamiast pytać. Odmowa ląduje jako `ToolStatus: 'declined'`, nie jako prośba o zgodę.
3. **Samo zdarzenie nie ma emitera.** `dist/core/ui-events.d.ts:270`, `UiPermissionRequestedEvent`, z komentarzem `RESERVED — wired when auto-approve becomes optional. Types only for now.` Trafienia: 2 w `.d.ts`, 0 w runtime `.js`, 0 w całym web UI.

Drugi runner nie zmienia obrazu: `codex` ma `approvalPolicy: 'never'` zaszyte na sztywno (`codex-app-server-runner.js:291`), a i tak `codex.available: false`, `defaultRunner: claude`.

**Zastrzeżenie:** ustawienie `CEZ_APPROVAL_GATE=1` tej gałęzi **nie ożywi**. Zmienna przełącza wyłącznie tryb uprawnień CLI na `acceptEdits`; Cezar nadal nie ma kodu, który zamieniłby `control_request can_use_tool` w zdarzenie UI. Ożywienie tej ścieżki to zmiana w Cezarze — poza zasięgiem PWA (patrz reguła 7 w `CLAUDE.md`: zgłaszamy jako propozycję issue upstream).

**Co z tym robimy w kodzie:** gałąź **zostaje** w `packages/shared/attention.ts`. Reguła 8 wymaga kopii 1:1 z Cezara, a słownik zdarzeń jest append-only — emiter może dojść w dowolnej wersji. Usunięcie gałęzi rozjechałoby nas z cockpitem dokładnie w momencie, w którym Cezar ją podłączy. Traktujemy ją jako nieosiągalną, nie jako nieistniejącą: bez testów E2E, bez UI do odpowiadania na prośbę o zgodę, z testem jednostkowym trzymającym zgodność z oryginałem.
