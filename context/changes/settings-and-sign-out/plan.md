# Settings and sign-out — Implementation Plan

## Overview

Close roadmap slice **S-12** (`settings-and-sign-out`). The operator can choose the theme (FR-046),
see the product's version and the Cezar version it talks to (FR-047), jump from a task to the same
task in the full cockpit (FR-048), and sign out, which clears everything the app holds locally and
stops notifications reaching this device (FR-006).

Derived from `context/foundation/roadmap.md` § S-12, the PRD, `docs/REQUIREMENTS.md` § 4.7 and the
S-10/S-11 code. See `change.md`.

## Current State Analysis

| Requirement | State before S-12 | Gap |
| --- | --- | --- |
| FR-046 theme | `index.css` switches on `prefers-color-scheme` only. `index.html` has one `theme-color` per scheme. | No way to force a theme, and nowhere to keep the choice. |
| FR-047 versions | The session probe returns `version` (`useSession` already exposed it "for S-12"). `TESTED_CEZAR_VERSION` exists. The app's own version is `0.0.0` in `package.json`. | Nothing shown. No build identity in the bundle. |
| FR-048 cockpit | The footer, the transcript's "older entries" note and the diff's "patch cut short" note all link to `/`, the cockpit's front page. | Not *the same task*. |
| FR-006 sign-out | Settings can turn notifications off (S-10). | No sign-out. The session is an `HttpOnly` cookie set by the gate, so the app cannot delete it, and Cezar has no sign-out endpoint (it has no sign-in). |

## What We're NOT Doing

- **No "Cezar is newer" warning.** Cut by the PRD (FR-047, Non-Goals). The tested version is shown
  beside the live one as a fact. `isCezarNewerThanTested()` stays unused.
- **No signing out other devices or Safari.** On iOS the installed app has its own cookie jar, so
  expiring the cookie there signs out this app only. The gate's secret is static and shared.
  Revoking access everywhere means rotating the key, which is the operator's job on the host.
- **No clearing the service worker's precache.** It holds the shell and nothing else (CLAUDE.md
  rule 4). Without it the signed-out app could not open offline to show "Połącz z Cezarem".
- **No theme-colour boot script in `index.html`.** The CSP has no `'unsafe-inline'`. `main.tsx`
  applies the stored theme before the first render instead. The page is empty until then, so all
  that can flash is the background, for the time it takes to load the precached module.
- **No change to Cezar.** The sign-out endpoint belongs to the perimeter, which the PRD puts in
  scope ("The perimeter's configuration is in scope for change; Cezar is not").

## Implementation

| # | Phase | Files |
| - | --- | --- |
| 1 | Theme: `ThemePreference` parse/resolve and `THEME_COLOR` (pure). `pwa/theme.ts` stores one word in `localStorage`, sets `data-theme` on `<html>` (none = system) and rewrites the `theme-color` tags. `index.css`: the light palette applies under `prefers-color-scheme: light` unless dark is forced, or when light is forced. `main.tsx` applies it before rendering. | `domain/theme.ts`, `pwa/theme.ts`, `index.css`, `main.tsx`, `features/settings/ThemeSection.tsx` |
| 2 | Versions: `vite.config.ts` stamps `__APP_COMMIT__` (from `GITHUB_SHA` in CI, else `git rev-parse`, else `dev`) and `__APP_BUILT_AT__`. Settings shows the commit and build time, the probe's Cezar version and `TESTED_CEZAR_VERSION`. | `vite.config.ts`, `config/app-version.ts`, `features/settings/VersionsSection.tsx` |
| 3 | Cockpit links: `cockpitTaskPath()` / `cockpitChangesPath()` after the cockpit's routes. A "W cockpicie ↗" link in the task's and the diff's top bar. The transcript's "older" note and the diff's "cut short" note point at the task / its Changes tab instead of `/`. | `domain/cockpit-link.ts`, `features/run/RunScreen.tsx`, `TranscriptView.tsx`, `features/diff/DiffScreen.tsx`, `FileDiff.tsx` |
| 4 | Sign-out, app: `signOut()` with injected steps. (a) The sidecar forgets the device (`DELETE /m/push/subscription`) while the gate still lets it through, then the device unsubscribes whatever the sidecar said. (b) The perimeter ends the session (`POST /m/session/end`, only a 204 counts). (c) Storage and IndexedDB are cleared. No step blocks the next. A sign-out that took restarts at `/m/`, which lands on "Połącz z Cezarem". One that did not stays and says which half is missing. Behind a confirmation. | `pwa/sign-out.ts`, `api/session.ts`, `api/http.ts` (`perimeterPost`, shared `send`), `features/settings/useSignOut.ts`, `SignOutSection.tsx`, `SettingsScreen.tsx` |
| 5 | Sign-out, perimeter: `signout-from-unlock.sh` reads the cookie's **name, Path and Secure** from the unlock guard `extract-unlock.sh` already copies (never the value), and writes `location = /m/session/end`. Same-origin `POST` → 204 + `Set-Cookie: <name>=; Max-Age=0; …`. `GET` → 405. Another origin, or none → 403. `install.sh` generates it next to the unlock file. `cezar-mobile.conf` includes it by glob, so a host without it answers 405 from the shell. | `deploy/nginx/signout-from-unlock.sh`, `install.sh`, `cezar-mobile.conf`, `rehearse.sh` |
| 6 | Tests, docs | see Progress; `docs/CEZAR_API.md` § 1a, `docs/REQUIREMENTS.md` § 4.7 |

### Design notes

- **Why the cookie name is generated, not written down.** It is the gate's to choose (`cezar_gate`
  live, `cezar_access` in the rehearsal), and the gate is not this repo's. Reading it from the
  guard the installer already copies keeps the two in step when the gate changes. The generated
  file holds no secret and is mode 644.
- **Why the `Set-Cookie` goes through a variable.** In nginx an `if` block inherits its location's
  `add_header`, so a literal `Set-Cookie` would ride on the 405 and the 403 as well. The rehearsal
  caught exactly that. The variable is set only after both checks pass, and an empty `add_header`
  value is not sent.
- **"Notifications stopped" means either half.** If the sidecar forgot the device, nothing is sent.
  If the device unsubscribed, nothing is delivered. Only both failing is reported.
- **The cockpit link is a plain `<a>`.** The cockpit is the gated site at `/`, outside the app's
  `/m/` scope, so iOS opens it outside the installed app's window. Whether it opens there with the
  app's session is up to iOS and cannot be checked from this repo. It is on the device checklist,
  as is the footer's cockpit link, which has worked this way since S-01.

## Progress

- [x] **Unit tests**: 731 passing (`npm test`), 50 more than after S-11, plus five existing
      assertions updated for the new links and the new Settings sections. Theme parse/resolve,
      palette parity between the two light blocks, and `THEME_COLOR` against `index.css` /
      `index.html`. Cockpit paths. The sign-out order, each failure path, and that it never throws.
      Storage and IndexedDB clearing. `endSession` counts only a 204. Settings: theme persist and
      restore, versions, the confirmation, a full sign-out, the not-installed perimeter, a sidecar
      down, both halves down. The task and diff screens link to the task / its Changes tab.
- [x] **Deliberate-break check**: ending the session before telling the sidecar, drifting one
      colour between the light blocks, and pointing the task link back at `/` each fail tests.
- [x] **E2E (WebKit, iPhone 14)**: 60 passing (`npm run test:e2e`), 5 new in
      `test/e2e/settings.spec.ts`. A forced theme beats the system and survives a reload, and the
      status-bar colour follows. The build and Cezar versions are shown. The task's cockpit link.
      Sign-out lands on "Połącz z Cezarem" with storage empty, sidecar first. A 405 from the
      perimeter is reported, not hidden.
- [x] **nginx rehearsal** (`deploy/nginx/rehearse.sh`): all expectations met. It checks that the
      generator prints nothing and writes no secret, and uses the gate's cookie name and attributes.
      `GET` → 405 and cross-site or Origin-less `POST` → 403, both without a cookie. A same-origin
      `POST` → 204 with `Set-Cookie` and the CSP. After it, the cockpit and the sidecar answer 403
      and the shell still loads.
- [x] **Dry run against the live gate** (read-only, into a temp dir, removed afterwards): the
      generated endpoint expires `cezar_gate` with `Path=/` and `Secure`. The key does not appear in it.
- [x] `npm run typecheck`, `npm run lint`, `npm run build` clean. Checked at 390×844 in both themes
      (`evidence/`).
- [ ] **Install on the VPS**: `sudo deploy/nginx/install.sh /etc/nginx/sites-available/cezar-cezar-ciey-studio`
      writes `/etc/nginx/snippets/cezar-mobile-signout.conf`. Until then, sign-out clears the phone
      and stops notifications, but says the session is still open. This is a production change, so
      it waits for the operator.
- [ ] **Device pass (iPhone, installed app)**:
  - [ ] Force Jasny on a dark phone (and Ciemny on a light one). The app and the status bar follow,
        and the choice survives closing the app.
  - [ ] Settings → Wersje shows the deployed commit and Cezar `0.11.0`.
  - [ ] On a task, "W cockpicie ↗" opens that task in the cockpit. If the cockpit answers 403 there,
        the link works but the session does not carry over. Record which of the two it is.
  - [ ] With notifications on: Wyloguj → confirm. The app lands on "Połącz z Cezarem". A task
        entering "needs you" no longer rings this phone. Pasting the access link unlocks it again.
