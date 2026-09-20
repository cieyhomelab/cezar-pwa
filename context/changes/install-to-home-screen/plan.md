# Install to the home screen Implementation Plan

## Overview

Close roadmap slice **S-01** (`install-to-home-screen`): the operator can install the
product to the phone's home screen, launch it full-screen from the icon, see a plain
offline state when there is no network, and accept a new version deliberately rather than
having it swap mid-use.

Derived from `context/foundation/roadmap.md` § S-01 and `context/foundation/prd.md`
FR-001, FR-002, FR-003. See `change.md` for why this plan is derived rather than authored.

## Current State Analysis

The M0 shell already carries most of the installation surface, so the gap is narrower than
the slice title suggests:

| S-01 capability | State today | Source |
| --- | --- | --- |
| Installable (manifest, icons, iOS meta) | **present** | `apps/pwa/vite.config.ts`, `apps/pwa/index.html`, `apps/pwa/public/icons/` |
| Launches full-screen (`display: standalone`, safe areas) | **present** | manifest + `apps/pwa/src/index.css` |
| Plain offline state | **absent** | `pl.offline.banner` exists in `apps/pwa/src/i18n/pl.ts` and nothing renders it |
| Deliberate update | **present, untested** | `registerType: 'prompt'` + the `needRefresh` block in `apps/pwa/src/App.tsx`; the only test asserts the prompt is *hidden* |

### Key Discoveries

- **The shell already survives offline; it just never says so.** `src/sw.ts` precaches the
  build output and registers a `NavigationRoute` bound to `/m/index.html`, so a cold launch
  with no network renders the app rather than a white screen. FR-002 asks for more than
  "not blank" — it asks the product to *say* it is offline. That message is the whole gap.
- **`navigator.onLine` is the only honest signal available in this slice.** It over-reports
  connectivity (a captive portal reads as online), but there is no data layer yet to
  contradict it. S-04 (`live-status`) owns real connection health; this slice must not
  pre-build it.
- **iOS never fires `beforeinstallprompt`, and Android is a PRD non-goal.** So the install
  affordance is a static Share-sheet instruction, shown only outside standalone mode — not
  a captured browser prompt. `navigator.standalone` is the iOS-only detection path and
  `matchMedia('(display-mode: standalone)')` the standard one; both are needed.
- **`docs/REQUIREMENTS.md` F-PWA-4 is stale.** It still calls for an IndexedDB snapshot
  behind the offline state. The PRD's Socratic round cut it explicitly ("the persisted
  snapshot is dropped. This overrides the source document's F-PWA-4"). Left as-is, the next
  agent implements a cut requirement.

## Desired End State

Launching the shell in a browser tab offers a Share-sheet install instruction; launching it
from the home-screen icon does not. Losing the network raises a persistent, screen-reader-
announced banner that clears when the network returns. A waiting service worker surfaces a
two-button prompt and never takes over until the operator presses it. All four behaviours
are covered by tests, with the offline path proven end-to-end in WebKit against a
production build.

## What We're NOT Doing

- **No persisted offline snapshot** (IndexedDB / `idb-keyval`). Cut by the PRD.
- **No real connection-health indicator.** That is S-04; `navigator.onLine` only.
- **No `beforeinstallprompt` capture / Android install flow.** Android is a non-goal.
- **Not removing the `idb-keyval` and `virtua` dependencies.** Roadmap Open Question 5
  flags them, but the owner is the operator and the call is outside this slice.
- **No icon badge** (FR-042, parked behind Open Roadmap Question 3).
- **No device verification.** Blocked on F-01; tracked as Manual in `## Progress`.

## Implementation Approach

Three chrome-level concerns — install, offline, update — get their own directory,
`apps/pwa/src/pwa/`, rather than joining `src/features/` (which CLAUDE.md reserves for
screens) or `src/domain/` (which it reserves for pure functions). Each concern splits into
a hook that touches the browser and a presentational component that does not, so the
components are testable without stubbing platform APIs. `App.tsx` stays a wiring layer.

## Critical Implementation Details

- Both online/offline listeners attach to `window`, and the hook seeds from
  `navigator.onLine` on mount so a tab that was already offline renders correctly.
- The standalone check is read once on mount. A session cannot transition between browser
  tab and installed app, so there is nothing to subscribe to.
- The offline banner carries `role="status"`, matching the update prompt, so the state
  change is announced rather than only coloured — NFR "status is legible without
  distinguishing colours".

## Phase 1: Offline state (FR-002)

### Overview

Say plainly that there is no network.

### Changes Required:

#### 1. `apps/pwa/src/pwa/useOnlineStatus.ts`

Subscribe to `online`/`offline` on `window`, seed from `navigator.onLine`, return a boolean.

#### 2. `apps/pwa/src/pwa/OfflineBanner.tsx`

Presentational, takes `online`; renders `pl.offline.banner` with `role="status"` when false.

#### 3. `apps/pwa/src/App.tsx`

Render the banner directly under the header, above the update prompt.

#### 4. `apps/pwa/test/setup.ts`

Default `window.matchMedia` stub — jsdom does not implement it and Phase 2 needs it.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` covers: banner hidden while online, shown while offline, and reacting to
      both the `offline` and `online` events
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

#### Manual Verification:

- [ ] On a real iPhone in Airplane Mode the banner appears and is legible in both themes

## Phase 2: Install affordance (FR-001)

### Overview

Tell the operator how to get the icon onto the home screen, and stop once it is there.

### Changes Required:

#### 1. `apps/pwa/src/pwa/useStandalone.ts`

`matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`.

#### 2. `apps/pwa/src/pwa/InstallHint.tsx`

Share-sheet instruction, session-dismissible via local state (no persistence — nothing
should be written to storage for this).

#### 3. `apps/pwa/src/i18n/pl.ts`

New `install` group: title, iOS instruction, dismiss label.

#### 4. `apps/pwa/index.html`

Add the unprefixed `mobile-web-app-capable` alongside the Apple one, and split
`theme-color` by `prefers-color-scheme` so the status bar matches the active theme.

#### 5. `apps/pwa/vite.config.ts`

Add a stable manifest `id` (`/m/`) so install identity does not move with `start_url`.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` covers: hint shown in a browser tab, hidden under `display-mode:
      standalone`, hidden under `navigator.standalone`, and dismissible
- [ ] `npm run test:e2e` asserts the hint is present on the built shell in WebKit
- [ ] `npm run build` emits a manifest carrying `id`, `scope` and `start_url` of `/m/`

#### Manual Verification:

- [ ] Share → Add to Home Screen produces a correctly named, correctly iconed launcher
- [ ] Launching from that icon is full-screen and shows no install hint

## Phase 3: Deliberate update (FR-003)

### Overview

Keep the existing behaviour; make it a unit under test instead of an inline block.

### Changes Required:

#### 1. `apps/pwa/src/pwa/UpdatePrompt.tsx`

Extract the `needRefresh` block from `App.tsx` as a presentational component taking
`needRefresh`, `onDismiss` and `onUpdate`.

#### 2. `apps/pwa/src/App.tsx`

Keep `useRegisterSW()` here and pass its values down.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` covers the `needRefresh: true` branch — previously unreachable, because
      the test stub always returns false — for both buttons
- [ ] The existing `App.test.tsx` assertions still pass unchanged

#### Manual Verification:

- [ ] Deploying a second build to a phone with the app open raises the prompt, and the app
      does not reload until the operator taps it

## Phase 4: Offline proof and doc correction

### Overview

Prove FR-002 against a real service worker, and stop F-PWA-4 sending the next agent after
a requirement the PRD cut.

### Changes Required:

#### 1. `test/e2e/install.spec.ts`

Runs against `vite preview`, because the worker and the manifest only exist in a
production build. Covers the manifest identity, both web-app-capable tags, the install
hint, the offline banner appearing and clearing under `context.setOffline`, and the
precache inventory.

> **Harness limit found while writing this.** The cold *offline navigation* cannot be
> driven in this stack: WebKit under Playwright fails internally on any navigation a
> service worker serves while the context is offline — `page.goto` and `page.reload` both
> error with "WebKit encountered an internal error", and `route.abort` cuts the navigation
> before the worker sees it ("Blocked by Web Inspector"). The suite therefore asserts the
> two conditions that decide whether that navigation can succeed — the worker takes
> control, and `/m/index.html` plus the assets are in the precache — and the cold offline
> launch moves to the device checklist. This is a limitation of the test harness, not of
> the shell.

#### 2. `docs/REQUIREMENTS.md`

Record the PRD override on F-PWA-4.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e` passes on `webkit-iphone`
- [ ] Full gate green: `npm run typecheck && npm run lint && npm test && npm run build`

#### Manual Verification:

- [ ] Cold launch from the icon in Airplane Mode renders the shell (the case the harness
      cannot drive)
- [ ] F-PWA-4 no longer reads as a live instruction to build the snapshot

## Phase 5: The dark theme does not exist (found in flight)

### Overview

Not planned. Found while capturing the both-themes evidence the repo's definition of done
requires: the dark and light screenshots came out **byte-identical**, and the built CSS
showed why — `:root` carried the *light* palette unconditionally and the dark values were
absent entirely.

**Cause.** Tailwind v4 hoists a `@theme` block out of any at-rule wrapping it. The
`@theme` nested inside `@media (prefers-color-scheme: light)` in `index.css` was therefore
never conditional: it landed in `:root` after the dark block and overwrote it. The app was
permanently light, including for an operator whose phone is in dark mode — while the
manifest's `theme_color`/`background_color` (`#0b1117`) still promised dark, so the
install splash contradicted the app it opened into.

**Why it is in this slice.** It blocks S-01's own acceptance twice over: the definition of
done asks for 390×844 verified in both themes, and the launch appearance is what this
slice delivers. The fix is contained to one file and lands as its own commit, so it can be
split out if it is judged to belong elsewhere.

### Changes Required:

#### 1. `apps/pwa/src/index.css`

Switch to `@theme inline` over plain custom properties, so the utilities emit
`var(--surface)` and the media query on `:root` — where a media query does work — picks
the palette. `light-dark()` would be tidier but needs Safari 17.5; these phones start at
iOS 16.4.

### Success Criteria:

#### Automated Verification:

- [ ] The built CSS carries the dark palette in `:root` and the light one inside
      `@media (prefers-color-scheme: light)`
- [ ] Full gate still green

#### Manual Verification:

- [ ] Screenshots at 390×844 differ between schemes and both are legible

## Testing Strategy

### Unit Tests

Vitest + Testing Library, jsdom. Platform APIs (`navigator.onLine`, `matchMedia`,
`navigator.standalone`) are stubbed per test; components are rendered with plain props.

### Integration Tests

Playwright, `webkit-iphone`, against the production build served by `vite preview` — the
only place the service worker and the generated manifest exist.

### Manual Testing Steps

All blocked on F-01 reaching the live host. Listed under Manual above.

## References

- `context/foundation/roadmap.md` § S-01
- `context/foundation/prd.md` FR-001, FR-002, FR-003, § Perimeter facts
- `docs/REQUIREMENTS.md` F-PWA-1 … F-PWA-5

## Progress

Manual items are all blocked on F-01 reaching the live host (`/m/` still answers 403), and
stay open until the operator can run them on the phone.

### Phase 1: Offline state

#### Automated

- [x] 1.1 Banner hidden online, shown offline, reacts to both events
- [x] 1.2 `npm run typecheck` passes
- [x] 1.3 `npm run lint` passes

#### Manual

- [ ] 1.4 Banner legible on a real iPhone in Airplane Mode, both themes

### Phase 2: Install affordance

#### Automated

- [x] 2.1 Hint shown in a tab, hidden in standalone (both detection paths), dismissible
- [x] 2.2 E2E asserts the hint on the built shell
- [x] 2.3 Built manifest carries `id`, `scope`, `start_url`

#### Manual

- [ ] 2.4 Add to Home Screen produces a correct launcher
- [ ] 2.5 Launching from the icon is full-screen and hides the hint

### Phase 3: Deliberate update

#### Automated

- [x] 3.1 `needRefresh: true` branch covered for both buttons
- [x] 3.2 Existing `App.test.tsx` assertions still pass

#### Manual

- [ ] 3.3 A second build raises the prompt and does not reload until tapped

### Phase 4: Offline proof and doc correction

#### Automated

- [x] 4.1 E2E passes on `webkit-iphone` (9/9)
- [x] 4.2 Full gate green

#### Manual

- [ ] 4.3 Cold launch in Airplane Mode renders the shell — the case the harness cannot
      drive; see the note under Phase 4
- [x] 4.4 F-PWA-4 no longer reads as a live instruction

### Phase 5: The dark theme does not exist (found in flight)

#### Automated

- [x] 5.1 Built CSS carries both palettes, the light one behind the media query
- [x] 5.2 Full gate still green

#### Manual

- [x] 5.3 Screenshots at 390×844 differ between schemes and both are legible
