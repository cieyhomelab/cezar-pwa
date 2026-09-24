# Backward compatibility

What this repository treats as a **protected contract surface**, and how a change to one has to ship. Review skills check PRs against this file; implementation skills warn when a change is not compliant.

The reason this matters more than usual here: the PWA is **installed on phones**. An installed app keeps its manifest identity, its push subscription and its stored settings across updates, and an old service worker may keep serving an old shell until the user reopens the app. A change that is "fine after a reload" can still strand a device that has not reloaded yet.

## Surfaces we consume (not ours to change)

The Cezar API (`/api/v1/…`), its SSE event vocabulary, and its nginx access gate belong to `open-mercato/cezar` and the VPS configuration. Cezar's own `BACKWARD_COMPATIBILITY.md` governs them; our side of the contract is:

- the vendored schemas in `packages/cezar-contract/` pinned by `UPSTREAM`, changed only via `npm run sync:contract <sha>`;
- `TESTED_CEZAR_VERSION` in `apps/pwa/src/config/cezar-compat.ts`;
- `docs/CEZAR_API.md`.

A change that needs different server behavior is an upstream issue proposal, never a patch to Cezar (CLAUDE.md rule 7). Tolerating new events and fields is mandatory; relying on an event or field that the deployed version does not send is a breaking change on our side.

## Protected surfaces we own

### 1. Installed-app identity — `apps/pwa/vite.config.ts` manifest, `deploy/nginx/cezar-mobile.conf`

`start_url: '/m/'`, `scope: '/m/'`, the service worker at `/m/sw.js`, and the same-origin `/m/` mount.

- **Breaking:** changing `start_url`, `scope`, the SW path or scope, the manifest `id`, or moving the app off `/m/`. iOS treats the result as a different app: users lose the home-screen install, its cookies and its push subscription.
- **Required path:** avoid. If unavoidable, keep the old path serving a redirect/SW that hands over for at least one release, document the reinstall in the PR body, label `risk-high`.

### 2. Deep links — `apps/pwa/src/routes.tsx`, `notificationclick` in `apps/pwa/src/sw.ts`

Routes under `/m/`: `/`, `/new`, `/p/:projectId/runs/:runId`, `/p/:projectId/runs/:runId/diff`, `/automations`, `/settings`. Notifications already delivered carry a `url` into these routes.

- **Breaking:** removing or renaming a route, or changing its parameter shape.
- **Required path:** keep the old route as a `<Navigate>` redirect; delivered notifications live up to `PUSH_TTL_SECONDS` (24 h) plus however long they sit in Notification Center.

### 3. Push payload — `PushPayload` in `packages/shared/src/notifications.ts`

Sent by `apps/push-sidecar`, read by `apps/pwa/src/sw.ts` / `src/pwa/push-message.ts`. Sidecar and shell deploy together, but an installed phone may still run the previous SW.

- **Breaking:** removing or renaming a field, changing a field's type, removing a `kind` value, or making the SW require a field.
- **Allowed:** adding optional fields and new `kind` values — the SW must render something sensible for an unknown `kind`.
- **Required path:** additive first; the SW must accept both shapes for one release before the sidecar drops the old one.

### 4. Push sidecar HTTP API — `apps/push-sidecar/src/app.ts`, exposed via nginx `/m/push/`

`GET /m/push/vapid-public-key`, `POST|DELETE /m/push/subscription`, `POST /m/push/test`, `GET /m/push/health`; JSON bodies, errors as `{ error }`, same-origin guard on writes.

- **Breaking:** removing or renaming a route, tightening the request schema so a body the current or previous shell sends is refused, changing a success or error status the shell branches on (201, 404, 410, 502, 504), or removing a response field.
- **Required path:** additive routes/fields; keep the old contract for one release; update `src/api/push.ts` in the same PR.

### 5. Push sidecar state — `STATE_DIR` (default `~/.cezar-push`)

`subscriptions.json` (`{ subscriptions: [...] }` validated by `subscriptionSchema` + `createdAt`), the VAPID key pair file, and the optional `env` file.

- **Breaking:** a format change the new sidecar cannot read, or anything that regenerates the VAPID pair — every device's subscription is bound to the public key and silently stops receiving pushes.
- **Required path:** the new code reads the old format (migrate on load, never drop valid entries; invalid ones go to `subscriptions.rejected.json` as today). VAPID rotation is a deliberate, announced operation with a re-subscribe path in the app, never a side effect.

### 6. Sidecar configuration — `apps/push-sidecar/src/config.ts`, `deploy/systemd/cezar-push.service`

Environment: `PUBLIC_ORIGIN` (required), `VAPID_SUBJECT`, `CEZAR_URL`, `STATE_DIR`, `HOST`, `PORT` (4330, which nginx proxies to).

- **Breaking:** renaming or removing a variable, making an optional one required, changing a default the unit file relies on, or changing the port without the nginx snippet.
- **Required path:** accept the old name as a fallback for one release; change unit file, nginx snippet and config together; note the operator step in the PR body.

### 7. On-device storage — `localStorage`

`cezar-mobile.theme` (`apps/pwa/src/pwa/theme.ts`), plus any other key under the `cezar-mobile.` prefix.

- **Breaking:** renaming a key or changing its value format without reading the old one — the user silently loses the setting.
- **Required path:** read the old key/format and migrate. Never store secrets here (CLAUDE.md rule 6).

### 8. Deploy interface — `scripts/deploy.sh`, `deploy/**`, `.github/workflows/deploy.yml`

The rsync target layout on the VPS, the rrsync path anchoring, the installers and the nginx snippet the gateway includes.

- **Breaking:** changing the target directory layout, the rrsync-anchored paths, required secrets, or what the nginx snippet expects from the surrounding server block.
- **Required path:** update the deploy notes in `OLD_README.md` (and the short steps in `README.md` if they change) in the same PR, keep `deploy/nginx/rehearse.sh` and `deploy/push/rehearse.sh` green, label `risk-high`, spell out any manual step on the host.

## Not protected

Internal module layout, component structure, the domain helpers in `apps/pwa/src/domain/`, npm script names other than those in `.ai/agentic.config.json`, test fixtures, and visual design may change freely — as long as the surfaces above still hold.

## Reviewing a change against this file

A PR that touches a protected surface says so in its body, names the surface by number, and states which required path it follows. Missing that on a breaking change is a **blocker** in `CODE_REVIEW.md` terms and makes the PR `risk-high`.
