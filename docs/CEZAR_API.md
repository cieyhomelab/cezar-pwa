# Cezar API — ściąga dla PWA

Źródło: `open-mercato/cezar` @ `main`, wersja pakietów **0.11.1** (wrzesień 2026).
Pliki źródłowe prawdy (sprawdzaj je przy każdej aktualizacji Cezara):

- `packages/contract/src/*.ts` — schematy zod wszystkich requestów/odpowiedzi (`runs.ts`, `events.ts`, `health.ts`, `workspace.ts`, `projects.ts`)
- `packages/api-client/src/protocol/ui-events.ts` — słownik zdarzeń agenta (SSE, `ui-event`)
- `packages/cezar/src/server/server.ts` — definicje tras, guardy, SSE
- `packages/web/src/lib/attention.ts` — logika „wymaga uwagi” (kopiujemy ją 1:1)
- `BACKWARD_COMPATIBILITY.md` — co jest zamrożone, a co może się zmienić

## 1. Zasady ogólne

- Używamy **wyłącznie** powierzchni wersjonowanej `/api/v1/…`. Stare `/api/…` są zamrożone dla bookmarkletów — nie budujemy na nich.
- Każda trasa projektowa istnieje w dwóch wariantach: `/api/v1/<path>` (projekt, w którym Cezar wystartował) i `/api/v1/p/:projectId/<path>`. **PWA zawsze używa wariantu z `projectId`**, bo pokazuje zadania ze wszystkich projektów.
- Cezar **nie ma własnego uwierzytelniania** — perimeter to reverse proxy (u nas: nginx + cookie). `createCezarClient({ token })` ma opcję Bearer, ale serwer jej dziś nie wymaga.
- **Guard same-origin (#426):** każdy `POST/PUT/PATCH/DELETE` z nagłówkiem `Origin` innym niż `Host` → `403`; `Sec-Fetch-Site: cross-site` → `403`. CORS jest otwarty tylko dla `GET /api/v1/health`. ⇒ **PWA musi być serwowana z tego samego originu** (`https://cezar.ciey.studio`), inaczej zapisy i odczyty nie zadziałają.
- Błędy mają kształt `{ "error": string }` + kod HTTP (400 walidacja, 404 brak, 409 konflikt stanu).

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
Istnieje (topiki na żądanie, np. `health`), ale nie jest potrzebny w MVP. Nie używamy.

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

Kopia `deriveAttention()` z `packages/web/src/lib/attention.ts` (first-match-wins):
1. oczekujące `permission.requested` → **permission** (najwyższy priorytet)
2. `failed` + `autoResumeAt` → zaplanowane, **bez** uwagi
3. `waiting` → czeka na odpowiedź
4. `review` → do przeglądu
5. `failed` → błąd
6. `running` + `activity: 'monitoring'` → bez uwagi

Powiadamiamy przy **wejściu** zadania w stan wymagający uwagi (przejście, nie stan), tak jak `web/src/lib/notifications.ts`.
