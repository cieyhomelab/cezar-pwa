# Cezar Mobile — wymagania (PRD)

Wersja 0.1 · 2026-09-20 · właściciel: Maciej Kulesza
Cel dokumentu: jedno źródło prawdy dla budowy PWA, z którego Claude Code (i człowiek) może pracować bez dopytywania.

## 1. Cel i kontekst

Cezar (`open-mercato/cezar`) to orkiestrator agentów kodujących działający na VPS pod `https://cezar.ciey.studio`, za nginx z ochroną przez cookie. Jego cockpit jest responsywny, ale to pełne narzędzie desktopowe. **Cezar Mobile** to lekka, instalowalna aplikacja PWA na iPhone'a (priorytet) i Androida, której główne zadanie to: **w 3 sekundy od otwarcia wiedzieć, co robią agenci i czy coś czeka na mnie** — a gdy czeka, móc to załatwić kciukiem.

### Sukces wygląda tak
- Otwieram ikonę na ekranie głównym → widzę listę zadań z żywymi statusami, zadania wymagające uwagi na górze.
- Dostaję push, gdy zadanie przechodzi w `waiting` / `review` / `failed`, nawet gdy aplikacja jest zamknięta.
- Klikam push → ląduję w transkrypcie tego zadania, odpowiadam agentowi albo akceptuję.

### Poza zakresem (świadomie)
Edycja workflowów, skilli, ustawień, automatyzacji; zarządzanie projektami i klonowanie; pełny widok Git/GitHub; porównywanie wariantów; paleta ⌘K. Do tego jest cockpit — PWA ma link „Otwórz w pełnym cockpicie”.

## 2. Architektura (decyzje)

| # | Decyzja | Uzasadnienie |
|---|---|---|
| A1 | PWA serwowana z **tego samego originu**: `https://cezar.ciey.studio/m/` | Cezar odrzuca zapisy cross-origin (guard #426), CORS ma tylko `/health`; cookie auth działa bez zmian |
| A2 | Statyczny build (Vite) w `/var/www/cezar-mobile`, nginx `location /m/` **przed** `location /` (proxy do Cezara) | Zero zmian w samym Cezarze, niezależne wdrażanie |
| A3 | Scope manifestu i Service Workera = `/m/` | SW nie może przechwytywać cockpitu ani `/api` |
| A4 | Dane: bezpośrednio `/api/v1/…` Cezara (REST + SSE) | Nie ma potrzeby backendu pośredniego dla odczytu |
| A5 | Push: mały **sidecar `cezar-push`** (Node) na VPS, słucha `http://127.0.0.1:4321/api/v1/workspace/events` (loopback, z pominięciem proxy), wysyła Web Push (VAPID) | Cezar nie ma Web Push; sidecar nie wymaga forka Cezara |
| A6 | Sidecar wystawia `POST/DELETE /m/push/subscription` i `GET /m/push/vapid-public-key` za tym samym cookie | Subskrypcje chronione tak samo jak cockpit |
| A7 | Typy i schematy zod **vendorowane** z repo Cezara (`packages/contract/src` + `ui-events.ts`) przypięte do commita; walidacja odpowiedzi zodem w trybie dev | Na npm są tylko prerelease'y 0.10.0-pr…, starsze niż serwer 0.11.x; vendoring daje zgodność z tym, co faktycznie działa na VPS |
| A8 | Stack: Vite + React 19 + TypeScript strict + Tailwind v4 + TanStack Query + React Router + `vite-plugin-pwa` (strategia `injectManifest`) | Ten sam stack co cockpit Cezara → łatwe przenoszenie komponentów; `injectManifest` bo potrzebujemy własnego handlera `push` |

Alternatywa rozważona i odrzucona na MVP: dodanie manifestu + SW do samego cockpitu Cezara (PR upstream). Dałoby instalowalność, ale nie „mobile-first” widok ani push. Można to zgłosić upstream później.

### Schemat
```
iPhone (PWA /m/) ──HTTPS+cookie──► nginx ─┬─ /m/          → statyczne pliki PWA
                                          ├─ /m/push/     → cezar-push :4330 (loopback)
                                          └─ /, /api/...  → Cezar :4321 (loopback)
cezar-push ──SSE (loopback, bez auth)──► Cezar /api/v1/workspace/events
cezar-push ──Web Push (VAPID)──────────► Apple/Google push service ──► iPhone
```

## 3. Uwierzytelnianie — wymagania i ograniczenia iOS

- **R-AUTH-1** Na iOS aplikacja zainstalowana na ekranie głównym ma **osobny słoik cookies** od Safari. Cookie ustawione w Safari **nie** przechodzi do PWA. Logowanie musi zadziać się wewnątrz zainstalowanej aplikacji.
- **R-AUTH-2** PWA wykrywa brak autoryzacji (odpowiedź 401/403 od nginx albo odpowiedź HTML zamiast JSON) i pokazuje ekran „Połącz z Cezarem”. Sondą jest `GET /api/v1/health` (§1a), a rozpoznanie siedzi w jednym miejscu: `apps/pwa/src/api/http.ts` → `AuthRequiredError`. **Brak sieci to nie brak autoryzacji** — `NetworkError` daje osobny ekran, bo wysyłanie operatora po link dostępowy w tunelu byłoby kłamstwem.
- **R-AUTH-3** ~~Ekran logowania: pole „Wklej link dostępowy” → aplikacja przechodzi na ten link w bieżącym kontekście (nie w nowej karcie), nginx ustawia cookie i przekierowuje z powrotem na `/m/`. Wymaga to, by mechanizm nginx wspierał parametr powrotu (np. `?next=/m/`). **Do potwierdzenia z właścicielem — patrz §9 Q1.**~~
  **Doprecyzowane po zbadaniu bramy (2026-09-20, §1a `CEZAR_API.md`).** Parametr powrotu nie istnieje i istnieć nie może — guard robi `return 302 https://$host$uri`, więc cały query string ginie, a **celem powrotu jest ścieżka linku**. Ekran „Połącz z Cezarem” bierze więc wklejony link, zostawia z niego wyłącznie parametr `key`, **podmienia ścieżkę na `/m/`** i przechodzi tam w bieżącym kontekście (`location.replace`, nigdy nowa karta — zainstalowana PWA ma własne ciasteczka). Implementacja: `apps/pwa/src/domain/access-link.ts` + `apps/pwa/src/features/auth/`.
- **R-AUTH-3a** ~~Jeśli brama nie obsłuży `?key=` pod `/m/` (guard może siedzieć w `location /`, a nie w `server` — z klienta tego nie widać), aplikacja wraca na `/m/` z niezużytym `key` w URL-u. Wtedy: **natychmiast usuwa `key` z wpisu historii** (`history.replaceState`) i pokazuje instrukcję „otwórz link w Safari i wróć”. Powrót do aplikacji sam ponawia sondę sesji (`visibilitychange`), więc operator nie musi niczego naciskać.~~
  **Poprawione 2026-09-21.** Rada „otwórz link w Safari i wróć” jest **fałszywa w zainstalowanej aplikacji** — ma ona własne ciasteczka (R-AUTH-1), więc sesja z Safari nigdy do niej nie trafi. W zainstalowanej PWA **nie ma drogi zapasowej**: odblokowanie działa pod `/m/` albo wcale. Gdy `key` wraca niezużyty, aplikacja nadal od razu usuwa go z historii, ale mówi prawdę: link jest niepełny albo serwer nie ma odblokowania pod `/m/` (`deploy/nginx/install.sh`). Radę „otwórz link w tej przeglądarce” pokazuje tylko w zwykłej karcie, gdzie słoik ciasteczek jest wspólny.
- **R-AUTH-3b** Klucz trafia do bramy **bajt w bajt tak, jak go wklejono**. nginx porównuje `$arg_key` z surowym query stringiem, więc przekodowanie (`/` → `%2F`, `=` → `%3D`, co robi `URLSearchParams.set`) zamienia poprawny klucz base64 w błędny. Pierwsza wersja S-02 miała dokładnie ten błąd.
- **R-AUTH-4** Cookie: `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age` ≥ 90 dni. Session cookie (bez Max-Age) zginie przy ubiciu aplikacji przez iOS.
- **R-AUTH-5** Link dostępowy nigdy nie trafia do manifestu, `localStorage`, logów ani repozytorium.
- **R-AUTH-6** Statyczny shell `/m/` (HTML, JS, ikony, manifest) może być publiczny — nie zawiera danych. Wszystko pod `/api` i `/m/push/` wymaga cookie. Dzięki temu manifest i ikony pobierają się poprawnie przy instalacji (Safari pobiera manifest bez cookies, o ile nie ma `crossorigin="use-credentials"`).

## 4. Wymagania funkcjonalne

Priorytety: **P0** = MVP, **P1** = zaraz po MVP, **P2** = później.

### 4.1 Lista zadań (ekran główny) — P0
- **F-LIST-1** Pobiera `GET /api/v1/workspace/runs-index` i pokazuje zadania ze wszystkich projektów.
- **F-LIST-2** Sekcje w kolejności: **Wymaga uwagi** (permission → waiting → review → failed), **Działa** (running, w tym monitoring), **W kolejce** (queued, z pozycją), **Zakończone** (done/cancelled, ostatnie 24 h, reszta pod „Pokaż więcej”). Zarchiwizowane ukryte.
- **F-LIST-3** Wiersz: tytuł (`titleSummary` ?? `title`), projekt, status (kolor + ikona + tekst, nie tylko kolor), czas trwania / „x min temu”, koszt (`costUsd`, jeśli capabilities.costMetrics), znacznik nieprzeczytanego, numer PR/issue.
- **F-LIST-4** Żywe aktualizacje przez `GET /api/v1/workspace/events` (`run`, `run-deleted`) — aktualizacja pojedynczego wiersza w cache, bez refetchu całej listy.
- **F-LIST-5** Pull-to-refresh i automatyczny refetch przy powrocie aplikacji na pierwszy plan (`visibilitychange`).
- **F-LIST-6** Wskaźnik połączenia: zielony (live), szary (łączenie), czerwony (offline / brak autoryzacji).
- **F-LIST-7** Filtr po projekcie (chipy) — zapamiętany lokalnie.

### 4.2 Szczegóły zadania — P0
- **F-RUN-1** Nagłówek: tytuł, projekt, status, workflow, kroki (`steps[]` jako pasek postępu z aktualnym `currentStepId`), runner/model, koszt, tokeny, gałąź, link do PR.
- **F-RUN-2** Transkrypt: ostatnia strona z `GET …/runs/:id/history`, starsze doładowywane przy przewinięciu w górę (`olderCursor`), wirtualizowana lista.
- **F-RUN-3** Live: `GET …/runs/:id/events?afterSeq=<asOfSeq>`; obsługa `ui-event` (item.started/delta/completed, plan.updated, turn.completed, ask.requested, session.*) oraz `run` (nagłówek).
- **F-RUN-4** Renderowanie itemów: wiadomości agenta jako Markdown; wywołania narzędzi zwinięte do jednej linii (ikona wg `toolKind` + `title` + status), rozwijane po tapnięciu (input/output, przycięte do ~4 KB z „pokaż całość”); reasoning zwinięty domyślnie; plan jako checklista przypięta u góry.
- **F-RUN-5** Auto-scroll na dół tylko gdy użytkownik jest przy dole; w przeciwnym razie przycisk „↓ nowe”.
- **F-RUN-6** Wejście w szczegóły wywołuje `POST …/runs/:id/read`.
- **F-RUN-7** Nieznane typy zdarzeń nie mogą wywalić widoku — renderuj ogólny wpis lub pomiń.

### 4.3 Akcje — P1
- **F-ACT-1** Odpowiedź na `ask.requested`: karta z pytaniami i opcjami (single/multi-select + „inna odpowiedź”), wysyłana jako jedna wiadomość `POST …/runs/:id/messages`.
- **F-ACT-2** Pole wiadomości do działającego/czekającego zadania (tekst, opcjonalnie zdjęcie z aparatu, max 4).
- **F-ACT-3** Przyciski kontekstowe: Anuluj (running/queued, z potwierdzeniem), Zaakceptuj/Zakończ (review), Utwórz draft PR (review, ma zmiany), Kontynuuj (done/failed), Przypnij, Archiwizuj.
- **F-ACT-4** Każda akcja: stan ładowania, błąd z treścią `error` z API, optymistyczna aktualizacja tylko tam, gdzie SSE i tak potwierdzi.
- **F-ACT-5** Podgląd diffu (`GET …/runs/:id/diff`) — tylko do odczytu, plik po pliku, zawijanie linii.

### 4.4 Szybkie nowe zadanie — P1
- **F-NEW-1** Formularz: projekt, treść zadania, workflow (domyślnie `quick-task`), przełącznik Autonomous, runner (z `health.checks` dostępnych).
- **F-NEW-2** `POST /api/v1/p/:projectId/runs`; po sukcesie przejście do szczegółów nowego zadania.
- **F-NEW-3** Share target (Android; iOS nie wspiera) — udostępnienie linku do issue GitHub do aplikacji prefilluje zadanie. P2.

### 4.5 Powiadomienia push — P1 (klient) + sidecar
- **F-PUSH-1** Ekran Ustawień → „Włącz powiadomienia” (prośba o zgodę **tylko** z gestu użytkownika — wymóg iOS).
- **F-PUSH-2** Na iOS przycisk widoczny tylko gdy aplikacja działa w trybie standalone (`display-mode: standalone`); w Safari pokazujemy instrukcję „Dodaj do ekranu początkowego”.
- **F-PUSH-3** Subskrypcja `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `POST /m/push/subscription`.
- **F-PUSH-4** Sidecar wysyła push przy **przejściu** zadania do stanu wymagającego uwagi (reguła z `CEZAR_API.md §5`); treść: tytuł zadania, projekt, powód („czeka na odpowiedź”, „do przeglądu”, „błąd”). Bez treści kodu ani transkryptu w payloadzie.
- **F-PUSH-5** Opcjonalnie push przy `done` (przełącznik w ustawieniach, domyślnie wyłączony).
- **F-PUSH-6** Kliknięcie powiadomienia → `clients.openWindow('/m/run/<projectId>/<runId>')` lub fokus istniejącego okna.
- **F-PUSH-7** Deduplikacja: jeden push na przejście (sidecar pamięta ostatni status per run); `tag` = runId, żeby kolejne powiadomienia o tym samym zadaniu zastępowały poprzednie.
- **F-PUSH-8** Badge ikony (`navigator.setAppBadge`) = liczba zadań wymagających uwagi; ustawiany przez aplikację i przez SW przy pushu.
- **F-PUSH-9** Sidecar usuwa subskrypcje, dla których push service zwraca 404/410.

### 4.6 Instalacja i offline — P0
- **F-PWA-1** Manifest: `name` „Cezar”, `short_name` „Cezar”, `start_url` `/m/`, `scope` `/m/`, `display` `standalone`, `theme_color`/`background_color` z ciemnego motywu, ikony 192/512 + maskable 512.
- **F-PWA-2** iOS: `apple-touch-icon` 180×180, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` = `black-translucent`, `viewport-fit=cover`, obsługa `env(safe-area-inset-*)`.
- **F-PWA-3** SW precache'uje tylko shell (`/m/**`). **Nigdy** nie cache'uje `/api/**` ani strumieni SSE (network-only, bez `respondWith`).
- **F-PWA-4** ~~Ostatni snapshot listy zadań trzymany w IndexedDB; offline → pokazujemy snapshot z datą i banner „offline”.~~
  **Zmienione przez PRD (FR-002).** Runda sokratejska odrzuciła trwały snapshot: „telefon prawie zawsze jest online, a dane sprzed godziny mylą bardziej niż ich brak”. Zostaje sam banner „offline” — bez IndexedDB, bez snapshotu. Patrz `context/foundation/prd.md` § FR-002 oraz Non-Goals.
- **F-PWA-5** Aktualizacja SW: „Nowa wersja — odśwież” zamiast cichego `skipWaiting` w trakcie użycia.

### 4.7 Ustawienia — P0/P1
Motyw (system/ciemny/jasny), powiadomienia (P1), filtr projektów, „Wyloguj” (czyści lokalne dane + usuwa subskrypcję push), wersja PWA i wersja Cezara (`health.version`) z ostrzeżeniem, gdy Cezar jest nowszy niż przetestowana wersja.

## 5. Wymagania niefunkcjonalne

- **NF-1 Wydajność:** pierwszy render listy z cache < 1 s na iPhone 12+; JS shell < 200 KB gzip (bez shiki; podświetlanie składni tylko w rozwiniętym diffie, ładowane leniwie).
- **NF-2 Odporność SSE:** iOS zamraża aplikację w tle i zrywa połączenia. Przy `visibilitychange → visible`: zamknij stare EventSource, refetch `runs-index` / `history`, otwórz nowe z `afterSeq`. Backoff reconnect 1 s → 30 s z jitterem. Maksymalnie 2 jednoczesne strumienie SSE (lista + otwarte zadanie).
- **NF-3 HTTP/2** na nginx (limit 6 połączeń na host w HTTP/1.1 blokowałby SSE).
- **NF-4 Dostępność:** statusy nie tylko kolorem, cele dotyku ≥ 44 pt, Dynamic Type (rem), kontrast AA w obu motywach.
- **NF-5 Bezpieczeństwo:** brak `innerHTML` z danych agenta (Markdown przez sanitizujący renderer), CSP dla `/m/` (`default-src 'self'; connect-src 'self'; img-src 'self' data: blob:`), brak zewnętrznych CDN.
- **NF-6 Kompatybilność:** iOS 16.4+ (Web Push), Safari/Chrome Android aktualne. Testowana wersja Cezara zapisana w `src/config/cezar-compat.ts`.
- **NF-7 Prywatność:** zero telemetrii, zero zewnętrznych usług poza push service Apple/Google.
- **NF-8 Język UI:** polski (teksty w jednym pliku `src/i18n/pl.ts`, gotowe pod dodanie EN).

## 6. Sidecar `cezar-push` — specyfikacja

- Node 20+, TypeScript, Hono, `web-push`, bez bazy — subskrypcje w `~/.cezar-push/subscriptions.json` (zapis atomowy), stan statusów w pamięci.
- Nasłuchuje na `127.0.0.1:4330`; nginx proxy `location /m/push/` → sidecar, za tym samym cookie.
- Łączy się z `http://127.0.0.1:4321/api/v1/workspace/events` (Host: `127.0.0.1` — przechodzi host-guard w trybie loopback; jeśli Cezar działa w trybie hosted, też przechodzi). Reconnect z backoffem; po reconnect pobiera `runs-index` i **nie** wysyła pushy za stany zastane (tylko przejścia).
- Klucze VAPID generowane raz (`cezar-push init`), trzymane w `~/.cezar-push/vapid.json` (0600); `subject` = `mailto:` właściciela z env.
- Endpointy: `GET /m/push/vapid-public-key`, `POST /m/push/subscription`, `DELETE /m/push/subscription`, `POST /m/push/test` (wysyła testowy push), `GET /m/push/health`.
- Serwis systemd `cezar-push.service` (user), logi przez journald, bez logowania treści zadań.

## 7. Konfiguracja nginx (docelowa, do zaadaptowania)

```nginx
# w istniejącym server { } dla cezar.ciey.studio, PRZED location /
location /m/push/ {
    # ta sama weryfikacja cookie co dla / (wstaw istniejący mechanizm)
    proxy_pass http://127.0.0.1:4330;
}
location /m/ {
    alias /var/www/cezar-mobile/;
    try_files $uri $uri/ /m/index.html;
    location = /m/sw.js { add_header Cache-Control "no-cache"; }
    location = /m/index.html { add_header Cache-Control "no-cache"; }
    location /m/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```
`listen 443 ssl http2;` musi być włączone.

## 8. Plan etapów

| Etap | Zakres | Kryterium ukończenia |
|---|---|---|
| **M0 — Szkielet** | Repo, Vite+React+TS+Tailwind, manifest, ikony, SW (shell), nginx `/m/`, deploy skrypt | Ikona na ekranie głównym iPhone'a otwiera pusty shell w trybie standalone |
| **M1 — Lista live** | Auth-detection + ekran logowania, `runs-index`, workspace SSE, sekcje, offline snapshot | Na telefonie widzę zadania i zmiany statusu w < 2 s |
| **M2 — Szczegóły** | Historia + SSE zadania, renderer itemów, plan, kroki, read | Obserwuję działającego agenta na żywo, po powrocie z tła nic nie ginie |
| **M3 — Akcje** | Ask/wiadomość, cancel/finish/PR/continue, diff, nowe zadanie | Obsłużę zadanie w stanie `waiting` i `review` bez laptopa |
| **M4 — Push** | Sidecar, subskrypcja, badge, deep-link z powiadomienia | Zablokowany telefon dostaje push, tap otwiera właściwe zadanie |
| **M5 — Szlif** | A11y, motywy, testy E2E na WebKit, dokumentacja wdrożenia | Checklista §5 spełniona |

## 9. Otwarte pytania (do właściciela)

- **Q1** ~~Jak dokładnie działa ochrona cookie na VPS? (nginx `map` na cookie, `auth_request`, oauth2-proxy, Cloudflare Access…?) Czy link dostępowy przyjmuje parametr powrotu (`?next=`)? Jaki `Max-Age` ma cookie? → wpływa na R-AUTH-3/4.~~
  **ROZSTRZYGNIĘTE 2026-09-20** przez odczyt żywej konfiguracji — nginx + statyczny sekret w `?key=`, cookie 30 dni, bez parametru powrotu (cel powrotu = ścieżka). Mechanika w `docs/CEZAR_API.md` §1a, konsekwencje w R-AUTH-3/3a.
  ~~**Zostaje jedno pytanie do właściciela:** czy guard `if ($arg_key = …)` stoi w bloku `server` (…), czy wewnątrz `location /` (…)?~~
  **ODPOWIEDŹ 2026-09-21: w `location /`.** Operator wkleił prawdziwy link w zainstalowanej PWA i dostał odmowę dla obu postaci linku. Potwierdza to pomiar bez klucza: `/m/` odpowiada 200 bez ciasteczka, więc kontrola bramy nie działa na poziomie `server` — a guard `?key=` stoi obok niej. `location ^~ /m/` nigdy nie wchodzi do `location /`, więc klucz pod `/m/` był po prostu ignorowany. **Naprawa jest po stronie bramy**, jak przewidywał PRD („that is fixed in the perimeter”): snippet `/m/` includuje kopię guarda (`/etc/nginx/snippets/cezar-mobile-unlock.conf`), którą `deploy/nginx/install.sh` wycina z vhosta na serwerze — sekret nie trafia do repo. Odtworzone i sprawdzone na lokalnym nginx 1.28.3 (ta sama wersja co na VPS): `deploy/nginx/rehearse.sh`. Z repo nie da się tego zainstalować — klucz wdrożeniowy to `rrsync -wo /var/www`; instalator trzeba uruchomić na VPS.
  **Zainstalowane i zweryfikowane 2026-09-21.** Guard nie siedzi w samym vhoście, tylko w `/etc/nginx/snippets/cezar-gate.conf`, includowanym w `location /` (kontrola ciasteczka czyta `map` z `conf.d/cezar-gate.conf`); ekstraktor przeszukuje więc vhost i pliki, które on includuje. Na żywej bramie: `/m/?key=<prawdziwy>` → 302 na `/m/` + `Set-Cookie`, zły klucz → powłoka bez ciasteczka, `/` i `/api/v1/health` bez ciasteczka → 403, sesja z `/m/` otwiera `/api/v1/health`. Wklejenie prawdziwego linku w aplikacji (WebKit, żywy host) kończy się na ekranie za bramką i przeżywa przeładowanie.
- **Q2** Czy nginx jest instalowany przez `cezar server-install` (wtedy vhost jest zarządzany przez Cezara i przy `server-install --reinstall` może zostać nadpisany), czy przez zewnętrzne proxy (`--external-proxy`)?
  **ODPOWIEDŹ 2026-09-21:** vhost generuje `cezar server-install` („Managed by cezar server-install — do not edit by hand”) i przepisuje go przy reinstalacji. Bramka przeżywa to dzięki `cezar-gate-ensure.path` + `.timer`, które przywracają **tylko** `include …/cezar-gate.conf`. **Nasz `include …/cezar-mobile.conf` nie jest przywracany** — po reinstalacji Cezara `/m/` trafi do `location /` i dostanie 403, więc ekran „Połącz z Cezarem” zniknie. Do czasu, aż to się zautomatyzuje: **po każdym `cezar server-install` uruchom ponownie `deploy/nginx/install.sh`**.
- **Q3** Ile projektów jest zarejestrowanych i czy Cezar działa na stabilnej, nightly czy develop? (wpływa na tempo zmian API)
- **Q4** Czy Android jest równorzędnym celem, czy tylko „ma działać”?
- **Q5** Push też przy `done`, czy wyłącznie gdy potrzebna jest reakcja?
