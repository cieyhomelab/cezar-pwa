# CLAUDE.md — Cezar Mobile (PWA)

Mobilna aplikacja PWA (iPhone priorytet, Android) do podglądu i sterowania instancją **Cezar** (`open-mercato/cezar`) działającą na `https://cezar.ciey.studio`. Aplikacja jest serwowana z tego samego originu pod `/m/`.

Przed pracą przeczytaj:
- `docs/REQUIREMENTS.md` — co budujemy, priorytety (P0/P1/P2), etapy M0–M5, otwarte pytania
- `docs/CEZAR_API.md` — endpointy, SSE, protokół zdarzeń, reguła „wymaga uwagi”

## Twarde reguły (nie łam bez pytania)

1. **Same-origin albo nic.** Cezar odrzuca zapisy cross-origin (403) i nie ma CORS poza `/health`. Nie proponuj hostowania PWA na innej domenie, Vercelu itp., nie dodawaj proxy CORS.
2. **Tylko `/api/v1/…`, zawsze w wariancie `/api/v1/p/:projectId/…`** dla tras projektowych. Nigdy legacy `/api/…`.
3. **Nie mirroruj DTO ręcznie.** Pakiety `@open-mercato/cezar-contract` i `cezar-api-client` są na npm tylko jako prerelease (`0.10.0-pr931…`, stan z 2026-09), starsze niż serwer (0.11.x). Dlatego `packages/cezar-contract/` w tym repo to **vendorowana kopia** `packages/contract/src/` oraz `packages/api-client/src/protocol/ui-events.ts` z repo Cezara, przypięta do commita zapisanego w `packages/cezar-contract/UPSTREAM` (skrypt `npm run sync:contract <sha>`). Nie edytuj tych plików ręcznie. Jeśli czegoś brakuje — dopisz lokalny typ w `src/api/types.local.ts` z komentarzem, skąd pochodzi.
4. **Service Worker nigdy nie dotyka `/api/**` ani strumieni SSE.** Scope SW = `/m/`. Precache tylko shell.
5. **Słownik zdarzeń jest append-only.** Każdy `switch` po `event.type` ma gałąź `default`, która nie rzuca. Nieznane pola ignoruj.
6. **Żadnych sekretów w repo, manifeście, localStorage ani logach** (link dostępowy, klucze VAPID, cookie).
7. **Nie modyfikujemy Cezara.** Zmiany po stronie serwera = konfiguracja nginx + sidecar `cezar-push`. Jeśli coś wymaga zmiany w Cezarze, opisz to jako propozycję issue upstream.
8. **Reguła uwagi = kopia `deriveAttention()`** z `packages/web/src/lib/attention.ts` Cezara. Jedna implementacja w `packages/shared/attention.ts`, używana przez PWA i sidecar.

## Stack

- Vite 8 + React 19 + TypeScript (strict, ESM) + Tailwind v4 — ten sam co cockpit Cezara, więc komponenty i tokeny motywu można podglądać w `packages/web/src/`
- React Router 7, TanStack Query 5 (cache serwera), `react-markdown` + `remark-gfm` (Markdown agenta, bez raw HTML — patrz `src/features/run/Markdown.tsx`)
- `vite-plugin-pwa` w trybie **`injectManifest`** (własny `src/sw.ts` z handlerami `push` i `notificationclick`), Workbox precache
- **Bez wirtualizacji list i bez trwałego snapshotu offline (IndexedDB)** — oba są Non-Goals w PRD. Nie dodawaj `virtua` ani `idb-keyval`; długie listy stronicuj, stan serwera trzymaj w cache TanStack Query.
- Testy: Vitest + Testing Library; E2E: Playwright z projektem **WebKit** (mobile Safari) — Chromium jest preinstalowany, nie uruchamiaj `playwright install` bez potrzeby
- Sidecar: Node 20+, Hono, `web-push`, zod

## Struktura repo (monorepo npm workspaces)

```
apps/pwa/                 # aplikacja PWA
  src/api/                # klient HTTP + SSE (fetch wrapper, EventSource manager)
  src/domain/             # czysta logika: attention, reducer transkryptu, formatowanie
  src/features/runs-list/ # ekran listy
  src/features/run/       # szczegóły zadania, transkrypt, akcje
  src/features/new-task/
  src/features/settings/
  src/features/auth/      # wykrywanie braku auth, ekran „Połącz z Cezarem”
  src/sw.ts               # service worker
  src/i18n/en.ts
  public/icons/
apps/push-sidecar/        # cezar-push
packages/shared/          # attention.ts, typy wspólne dla PWA i sidecara
packages/cezar-contract/  # vendorowane schematy zod + ui-events z repo Cezara (UPSTREAM = sha)
deploy/nginx/             # snippet location /m/ i /m/push/
deploy/systemd/           # cezar-push.service
scripts/deploy.sh         # build + rsync na VPS
docs/
```

## Komendy

```bash
npm install
npm run dev            # PWA na :5173, proxy /api → CEZAR_URL (patrz niżej)
npm run build          # build PWA do apps/pwa/dist (base: /m/) + sidecar
npm run typecheck
npm test               # vitest (pwa + sidecar + shared)
npm run test:e2e       # playwright, projekt webkit-iphone
npm run deploy         # scripts/deploy.sh — wymaga DEPLOY_HOST w .env.local
```

### Dev na żywym Cezarze
Vite proxy `/api` → `https://cezar.ciey.studio` z nagłówkiem `Cookie` z `.env.local` (`CEZAR_COOKIE=…`, plik w `.gitignore`). Proxy musi przepisywać `Origin` na `https://cezar.ciey.studio` (`changeOrigin: true` + ręczne `headers.origin`), inaczej guard same-origin odrzuci zapisy.
Bez dostępu do VPS: lokalnie `CEZ_DRY_RUN=1 npx cezar-cli` (mock agenta) i `CEZAR_URL=http://127.0.0.1:4321`.

## Konwencje kodu

- Kod, identyfikatory, commity po angielsku; teksty UI po angielsku, wyłącznie przez `src/i18n/en.ts` (aplikacja jest jednojęzyczna).
- Komponenty funkcyjne, bez klas; logika domenowa jako czyste funkcje w `src/domain/` z testami tablicowymi.
- Stan serwera tylko w TanStack Query; SSE aktualizuje cache przez `queryClient.setQueryData`, nie przez osobny store.
- Klucze query: `['runs-index']`, `['run', projectId, runId]`, `['history', projectId, runId]`, `['changes', projectId, runId]`, `['health']`.
- Transkrypt: reducer `(state, uiEvent) => state` w `src/domain/transcript.ts`, id-keyed (`item.started` → `item.delta` dokleja → `item.completed` nadpisuje). Testuj go na nagraniach NDJSON z `test/fixtures/`.
- Każde wywołanie API przez `src/api/http.ts`, który: rozpoznaje brak auth (401/403 lub odpowiedź HTML zamiast JSON → `AuthRequiredError`), parsuje `{error}` z API, ma timeout.
- CSS: Tailwind, mobile-first, `env(safe-area-inset-*)` na górnym/dolnym pasku, cele dotyku ≥ 44 px.
- Brak `dangerouslySetInnerHTML` z danymi agenta.

## Specyfika iOS — pamiętaj

- Zainstalowana PWA ma **osobne cookies** od Safari → logowanie w aplikacji (ekran „Połącz z Cezarem”).
- Prośba o powiadomienia tylko z gestu użytkownika i tylko w trybie standalone (iOS 16.4+).
- iOS zamraża aplikację w tle: po `visibilitychange → visible` zamknij i otwórz SSE na nowo, refetch danych, wznawiaj transkrypt od `afterSeq`.
- Nie polegaj na `beforeinstallprompt` (nie istnieje na iOS) — pokaż instrukcję „Udostępnij → Dodaj do ekranu początkowego”.
- Testuj na prawdziwym urządzeniu przed zamknięciem etapu; symulator nie odbiera Web Push.

## Definicja „gotowe” dla każdego zadania

1. `npm run typecheck && npm test` przechodzą.
2. Nowa logika domenowa ma testy; zmiana UI — test komponentu lub E2E (WebKit).
3. Działa offline w sensie: brak sieci nie daje białego ekranu.
4. Sprawdzone w widoku 390×844 (iPhone 14) w obu motywach.
5. Jeśli dotyka API Cezara — zaktualizowany `docs/CEZAR_API.md`.

## Gdy API Cezara się zmieni

Sprawdź `CHANGELOG.md` i `BACKWARD_COMPATIBILITY.md` w repo Cezara, uruchom `npm run sync:contract <sha>` dla commita odpowiadającego wersji na VPS (`GET /api/v1/health` → `version`), podbij `TESTED_CEZAR_VERSION` w `apps/pwa/src/config/cezar-compat.ts`, uruchom testy kontraktowe (`test/contract/*.test.ts` — walidują fixture'y schematami zod z `packages/cezar-contract`).
