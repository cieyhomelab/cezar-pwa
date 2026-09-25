# cezar-push

The Web Push sidecar for Cezar Mobile (`docs/REQUIREMENTS.md` § 6, roadmap S-10). It runs beside
Cezar on the VPS, follows Cezar's workspace event stream on loopback, and when a task **enters** a
state that needs the operator (waiting, review, failed — `packages/shared/src/notifications.ts`)
it sends a Web Push to every subscribed device. The notification says which task, which project
and why; no code, no transcript.

Cezar itself is not modified (CLAUDE.md rule 7).

## Endpoints

Served on `127.0.0.1:4330` under `/m/push/`; nginx forwards them only past the cookie gate
(`deploy/nginx/cezar-mobile.conf`). Writes from another origin are refused. Errors are `{ error }`.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/m/push/vapid-public-key` | `{ publicKey }` for `pushManager.subscribe` |
| `POST` | `/m/push/subscription` | `PushSubscription.toJSON()`; only Apple/Google/Mozilla/Microsoft push endpoints |
| `DELETE` | `/m/push/subscription` | `{ endpoint }` → `{ removed }` |
| `POST` | `/m/push/test` | `{ endpoint }` → a test push to that device only; 404 unknown, 410 gone, 502 refused, 504 the push service never answered |
| `GET` | `/m/push/health` | stream state, baseline time, counts — never a task |
| `GET` | `/m/push/limits` | each agent account's 5-hour / weekly windows from the last poll (`LimitsResponse`, `packages/shared/src/limits.ts`); `Cache-Control: no-store` |

## State

`~/.cezar-push/` (mode 0700): `vapid.json` (the key pair, created once by `init`, never rotated)
and `subscriptions.json` (atomic writes). Both 0600, neither in the repo. A device the push
service reports gone (404/410), or whose `expirationTime` has passed, is dropped. A send that runs
past its ten-second deadline is given up on and logged as a timeout; the device stays, because a
push service that stalls says nothing about it.

## One ring per transition (S-11)

The watcher remembers each run's last status in memory and rings only when it CHANGES into one
that needs the operator. A reconnect or a restart re-seeds from the runs index silently, so work
that was already waiting never rings again. A transition that happens while the sidecar is down is
not announced afterwards. Each push about a task carries a `Topic` (a hash of `project/run`), so
the push service keeps only the newest undelivered one. The phone's per-task `tag` does the same
for notifications already shown.

## Limits (#92)

`src/limits/` polls every provider × account every five minutes (`LIMITS_POLL_SECONDS`, at least
60) and keeps only the last pass in memory. `GET /m/push/limits` serves that pass and starts no
work, so the phone never triggers a read. None of the reads spends quota.

- **Accounts** come from Cezar's `GET /api/v1/workspace/agent-profiles` on loopback, each read
  from its own config dir. A provider with no profile (on this host `profiles: []`), or a Cezar
  that cannot be read, gets one `default` account: the CLI's own login.
- **Codex** (`LIMITS_CODEX`, on by default): spawns `codex app-server` as the service user and
  calls `account/rateLimits/read`, with `CODEX_HOME` set for a profile. Windows are told apart by
  `windowDurationMins` (300 → `five_hour`, 10080 → `weekly`), never by `primary`/`secondary`; a
  window Codex does not report is absent, never 0. The child is killed on every path (15 s
  timeout). The binary is `codex` on `PATH` or in `~/.local/bin` — where Cezar's own unit finds
  its CLIs, which the sidecar's systemd `PATH` lacks — or `LIMITS_CODEX_BIN`. No binary →
  `codex not installed`.
- **Claude** (`LIMITS_CLAUDE`, **off** by default): reads the OAuth token from the account's
  `.credentials.json` on every request and calls Anthropic's **undocumented**
  `GET https://api.anthropic.com/api/oauth/usage` — the endpoint behind `/usage` — for the
  5-hour, weekly and per-model (Opus, Sonnet) weekly windows. The token lives only in that
  request's header: never logged, cached, written or quoted in a reason. An expired token is
  reported, not refreshed (the next `claude` run renews it). Turning it on is the operator's call:
  it is the sidecar's only call to a third party besides the push services.
- **No stale numbers.** Every pass replaces every row; an adapter that fails gives
  `status: "unavailable"` + `reason` and no windows. A row the loop has not refreshed for three
  intervals is served as `unavailable` too. Each row carries its own `observedAt`.
- The log says when a row's status changes (`limits: codex/default unavailable (codex not
  installed)`), never a number or a path.

## Run

```sh
npm run build -w @cezar-pwa/push-sidecar   # tsc + one-file bundle: dist/cezar-push.mjs
node dist/cezar-push.mjs init              # once: VAPID keys (prints only the public key)
node dist/cezar-push.mjs                   # serve + watch
```

Environment: `HOST` (127.0.0.1), `PORT` (4330), `CEZAR_URL` (`http://127.0.0.1:4322`),
`STATE_DIR` (`~/.cezar-push`), `VAPID_SUBJECT` (`mailto:` or `https:`, default `PUBLIC_ORIGIN`),
and `PUBLIC_ORIGIN`, which is **required**: the bare `https://host[:port]` origin the app is served
from, the only one a write may come from. With no default, a sidecar on the wrong host fails to start
instead of answering 403 to every subscribe. A trailing slash or a path is refused too, since the
check compares it with the browser's `Origin` header as an exact string.

On the VPS, `deploy/push/install.sh` (as the user Cezar runs as) builds, installs the user unit
`deploy/systemd/cezar-push.service` and starts it. Logs: `journalctl --user -u cezar-push`.
It renders the unit with the `CEZAR_PUSH_HOME` and `STATE_DIR` it used, so an override reaches
`WorkingDirectory`, `ExecStart`, `STATE_DIR` and the `EnvironmentFile` as well as the files on
disk. `deploy/push/rehearse.sh` rehearses that in a scratch `$HOME`.
