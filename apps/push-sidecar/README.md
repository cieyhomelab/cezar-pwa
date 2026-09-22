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
| `POST` | `/m/push/test` | `{ endpoint }` → a test push to that device only; 404 unknown, 410 gone |
| `GET` | `/m/push/health` | stream state, baseline time, counts — never a task |

## State

`~/.cezar-push/` (mode 0700): `vapid.json` (the key pair, created once by `init`, never rotated)
and `subscriptions.json` (atomic writes). Both 0600, neither in the repo. A device the push
service reports gone (404/410), or whose `expirationTime` has passed, is dropped. An entry that
no longer validates at start (a hand edit, a tightened push-host allowlist) is skipped and set
aside in `subscriptions.rejected.json` (0600); the journal logs only the count. A file that is not
JSON or not `{ "subscriptions": [...] }` still stops the service rather than being wiped.

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
`STATE_DIR` (`~/.cezar-push`), `VAPID_SUBJECT` (`mailto:` or `https:`, default the site URL),
`PUBLIC_ORIGIN` (`https://cezar.ciey.studio`).

On the VPS, `deploy/push/install.sh` (as the user Cezar runs as) builds, installs the user unit
`deploy/systemd/cezar-push.service` and starts it. Logs: `journalctl --user -u cezar-push`.
