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
