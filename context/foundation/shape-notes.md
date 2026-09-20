---
project: "Cezar Mobile"
context_type: greenfield
created: 2026-09-20
updated: 2026-09-20
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "all three co-exist: blocked runs idle, no situational awareness, cockpit unusable with a thumb"
    - topic: "primary persona scope"
      decision: "single named operator; one Cezar instance, one cookie"
    - topic: "insight"
      decision: "existence proof, not proprietary insight - someone else built a comparable PWA; user has no access to it"
    - topic: "perimeter mechanism"
      decision: "nginx + cookie set from an access link; the vhost is ours to change, Cezar is not"
    - topic: "MVP scope"
      decision: "full M0-M5 from REQUIREMENTS.md chosen over a scoped-down first slice"
    - topic: "timeline"
      decision: "12 weeks after-hours, no hard deadline, sustained-effort cost acknowledged"
    - topic: "Socratic round form"
      decision: "targeted (10 FRs with a real counter-argument) rather than exhaustive over 48"
    - topic: "transcript depth"
      decision: "latest page only is must-have; backwards paging and virtualization demoted"
    - topic: "offline behaviour"
      decision: "clear offline state, no persisted snapshot; overrides F-PWA-4"
    - topic: "Android"
      decision: "not a target at all - iPhone only, no share target, no Android test pass"
    - topic: "notification discipline"
      decision: "notify only on states needing a human; never on completion"
    - topic: "project count"
      decision: "more than eight registered projects, so the project filter stays must-have"
    - topic: "domain rule ownership"
      decision: "exact copy of Cezar deriveAttention(); one shared implementation for app and sidecar; quiet hours and cost/duration triggers rejected"
    - topic: "product type"
      decision: "web-app delivered as an installable PWA; no app store; mobile label rejected to avoid steering stack selection toward native toolchains"
    - topic: "non-goals added"
      decision: "never modify Cezar; never multi-user or multi-instance; no syntax highlighting in diff; no background work beyond push"
  frs_drafted: 46
  quality_check_status: accepted
---

# Shape Notes — Cezar Mobile

Seed material: `docs/REQUIREMENTS.md` (v0.1, 2026-09-20) and `docs/CEZAR_API.md`, both
authored by the project owner before this session. Content below is either quoted from
those documents or captured verbatim from the discovery conversation.

## Vision & Problem Statement

A coding-agent orchestrator (Cezar, `open-mercato/cezar`) runs on a VPS at
`https://cezar.ciey.studio` behind an nginx cookie perimeter. Its agents regularly stop
and wait: a run enters `waiting` (agent asked a question), `review` (work ready for
acceptance), or `failed`. Nothing surfaces that to the operator when they are away from
their laptop. The run sits blocked for as long as it takes the operator to get back to a
desk — calendar time burned on a task that needed a ten-second answer.

Three distinct pains were confirmed as co-existing, all real:

1. **Blocked runs sit idle.** Delay-to-response is the headline cost.
2. **No situational awareness.** How many runs are live, what they cost, whether anything
   broke — unknown until the cockpit is opened on a desktop.
3. **The cockpit does not work under a thumb.** Even with Safari open on the phone, the
   full desktop tool is not a usable surface for answering an agent.

**Insight (captured verbatim from the owner):** "Pomysł został zrealizowany przez kogoś,
ale nie mam do niego dostępu, tylko dowiedziałem się, że można coś takiego zrobić jak PWA
na iPhone z frameworkiem Cezar." — i.e. this is an *existence proof*, not a proprietary
insight. Someone has built a comparable PWA against Cezar; the owner has no access to it
and only knows the shape is feasible. Consequence: feasibility risk is low, competitive
advantage is nil — and irrelevant, because this is a single-operator tool.

Supporting observation from `docs/REQUIREMENTS.md` §2: the alternative of adding a
manifest + service worker to the Cezar cockpit itself (an upstream PR) was considered and
rejected for the MVP — it would grant installability but neither a mobile-first view nor
push.

## User & Persona

**Primary persona — the operator.** A single named person: the owner of this Cezar
instance. One instance, one nginx cookie, no role separation. Context: away from the
desk, phone in pocket, several agent runs in flight. The moment they reach for this
product is the moment a push notification tells them a run needs a human — or the moment
they want to know, in under three seconds, whether anything needs them at all.

No secondary persona. Multi-user and multi-instance support are out of scope for the MVP.

## Access Control

Single operator; no application-level auth. Cezar itself ships no authentication — the
perimeter is nginx on the VPS, which sets a cookie when the operator visits an access
link. The PWA therefore never implements login logic of its own; it detects the *absence*
of a valid cookie and hands the operator back to the perimeter.

Decisions locked in this phase:

- **Perimeter mechanism: nginx + cookie set from an access link.** (Resolves Q1 of
  `docs/REQUIREMENTS.md` §9 at the mechanism level. The exact cookie name, `Max-Age`, and
  whether the access link already accepts a return parameter still need to be read off the
  live vhost — see Open Questions.)
- **The nginx vhost is in scope for change; Cezar is not.** If the access link does not
  support returning to `/m/` after the cookie is set, that is fixed in the vhost
  configuration, not in Cezar. Anything that would require changing Cezar is written up as
  an upstream issue proposal instead. This matches rule 7 of the project `CLAUDE.md`.
- **No role separation.** One person, one cookie, one instance. Every route the operator
  can reach in the cockpit, they can reach in the PWA.
- **Unauthenticated behavior.** The static shell under `/m/` (HTML, JS, icons, manifest)
  is public and carries no data, so installation works before the cookie exists.
  Everything under `/api/` and `/m/push/` requires the cookie. A data request that comes
  back as 401/403 — or as an HTML login page instead of JSON — puts the app on the
  "Connect to Cezar" screen rather than showing a broken list.
- **No credential is ever stored by the app.** The access link is not written to
  `localStorage`, the manifest, logs, or the repository; the cookie is `HttpOnly` and lives
  in the browser's jar, not in application state.

## Success Criteria

### Primary

- The operator receives a notification on a locked iPhone when a run enters a state that
  needs a human, taps it, lands in that run's transcript, answers the agent from the
  phone, and the run resumes — the whole loop closed without opening a laptop.
- Opening the home-screen icon shows the current state of every run across all projects,
  with the ones needing attention first, in under three seconds.

### Secondary

- The operator can start a new task from the phone.
- The operator can see what an agent changed (diff) and what it cost, from the phone.
- The app icon carries a badge with the number of runs needing attention, so a glance at
  the home screen answers "does anything need me?" without opening anything.

Not counted as secondary because it is a must-have: the offline snapshot
(`docs/REQUIREMENTS.md` F-PWA-4, P0). No network must never produce a blank screen.

### Guardrails

All four were confirmed as hard — a failure here is a regression even if the primary
criteria hold:

- **No secret ever lands in the repository, `localStorage`, the manifest, or logs.** This
  covers the access link, the VAPID keys, and the session cookie.
- **Unknown data never breaks the view.** An unrecognised event type, a new field, or an
  older v1 recording renders generically or is skipped — never a white screen. Cezar's
  event dictionary is append-only and will grow.
- **Nothing caches `/api/**` or the event streams.** Serving a stale status the operator
  trusts is the worst failure mode available here, because it is silent.
- **No telemetry and no third-party services.** No CDNs, no analytics, no external fonts.
  The only outbound traffic beyond the operator's own VPS is to the Apple/Google push
  service.

## Timeline acknowledgment

Acknowledged on 2026-09-20: the operator chose the full M0–M5 scope from
`docs/REQUIREMENTS.md` §8 over a scoped-down first slice, with an estimate of 12 weeks of
after-hours work and no hard deadline. The cost was stated explicitly — six milestones
including a separate always-on service (the push sidecar), a bespoke transcript renderer,
and a VPS deployment path — and accepted. Per-milestone breakdown behind the estimate:
M0 ~1 week, M1 ~2, M2 ~3, M3 ~2, M4 ~2, M5 ~1.5.

Known tension surfaced during this phase and left standing by the operator's choice: the
document's own "success looks like" statement (§1) depends on push and on replying to the
agent, both of which sit at priority P1 while P0 is list + detail + install. Choosing the
full scope resolves the tension by putting everything in the first release; the
consequence is that nothing ships until the whole chain works. The milestone order
(M0 → M5) is the mitigation — each milestone is independently deployable.

## Functional Requirements

Transcribed from `docs/REQUIREMENTS.md` §4 (the operator's own F-* list), then put through
a targeted Socratic round. Priority maps from the document's P-levels — P0 and P1 start as
`must-have` because the operator chose the full M0–M5 scope — and was then revised
wherever a counter-argument landed.

The Socratic round was run in targeted rather than exhaustive form by explicit agreement:
48 requirements would have meant roughly 12 rounds of questions, and decision fatigue
would have turned the later rounds into rubber-stamping. Ten requirements carrying a real
counter-argument were challenged; the rest are inherited from `docs/REQUIREMENTS.md`
unchallenged. Numbering has gaps where a requirement was cut — the gaps are deliberate, so
the Socratic record below stays readable.

### Installation and shell

- FR-001: Operator can install the app to the iPhone home screen and launch it standalone. Priority: must-have
- FR-002: Operator can open the app with no network and see a clear offline state rather than a blank screen or an endless spinner. Priority: must-have
  > Socrates: Counter-argument accepted — "a phone is almost always online, and hour-old
  > data can mislead more than its absence; a readable message costs an hour, IndexedDB
  > costs days plus a new class of staleness and schema-migration bugs." Resolution: the
  > persisted snapshot is dropped. This overrides F-PWA-4 of `docs/REQUIREMENTS.md`, which
  > called for an IndexedDB snapshot at P0.
- FR-003: Operator can accept a new version of the app deliberately, rather than having it swap underneath them mid-use. Priority: must-have

### Access

- FR-004: Operator can tell from inside the installed app that it is not authorized, and is shown a "Connect to Cezar" screen instead of an error or an empty list. Priority: must-have
- FR-005: Operator can complete authorization from inside the installed app and land back on the task list. Priority: must-have
- FR-006: Operator can sign out, which clears local data and removes the push subscription. Priority: must-have

### Task list

- FR-007: Operator can see tasks from every registered project in one list. Priority: must-have
- FR-008: Operator can see tasks grouped as Needs attention / Running / Queued / Finished, attention first, archived hidden. Priority: must-have
- FR-009: Operator can read a task's title, project, status, timing, cost, unread marker and PR/issue number from the row without opening it. Priority: must-have
- FR-010: Operator can see status changes appear live, without refreshing and without the list jumping. Priority: must-have
- FR-011: Operator can pull to refresh, and the list refreshes itself when the app returns to the foreground. Priority: must-have
- FR-012: Operator can tell whether the live connection is healthy, reconnecting, or lost. Priority: must-have
- FR-013: Operator can filter the list by project, and the choice survives a restart. Priority: must-have
  > Socrates: Counter-argument considered — "below a handful of projects a filter is dead
  > code; section headings and a per-row project label would do." Resolution: stands. The
  > instance carries more than eight registered projects, so the list is unreadable on a
  > phone without one. This also answers Q3 of `docs/REQUIREMENTS.md` §9.

### Task detail

- FR-014: Operator can see a task's header: status, workflow, step progress, runner and model, cost, tokens, branch, PR link. Priority: must-have
- FR-015: Operator can read the most recent stretch of a task's transcript. Priority: must-have
  > Socrates: Counter-argument accepted — "on a phone I care about what the agent is doing
  > now and what it is asking, not archaeology from an hour ago." Resolution: paging
  > backwards through history and list virtualization both leave the must-have set; only
  > the latest page is required. Resuming after a freeze (FR-021) was explicitly kept. The
  > demoted remainder is FR-049. This is the largest scope cut of the session.
- FR-016: Operator can watch the transcript update live while the agent works. Priority: must-have
- FR-017: Operator can read agent messages as formatted text, sees tool calls collapsed to one line, and can expand one to inspect its input and output. Priority: must-have
- FR-018: Operator can see the agent's current plan as a checklist pinned above the transcript. Priority: must-have
- FR-019: Operator can stay where they scrolled, with a "new messages" affordance instead of being yanked to the bottom. Priority: must-have
- FR-020: Opening a task marks it read. Priority: must-have
- FR-021: Operator can return to the app after iOS froze it and resume the transcript with nothing lost and nothing duplicated. Priority: must-have

### Acting on a task

- FR-022: Operator can answer an agent's question by picking from the offered options or writing their own answer. Priority: must-have
- FR-023: Operator can send a free-text message to a running or waiting task. Priority: must-have
- FR-025: Operator can cancel a running or queued task, behind a confirmation. Priority: must-have
  > Socrates: Counter-argument considered across FR-025 to FR-029 — "housekeeping actions
  > will happily wait for a laptop." Resolution: every action in the set was kept as
  > must-have, including the housekeeping ones. Cancel, finish and continue each close the
  > loop for one of the push reasons; the operator judged draft-PR, pin and archive worth
  > having under a thumb as well.
- FR-026: Operator can accept and finish a task that is in review. Priority: must-have
- FR-027: Operator can open a draft PR for a reviewed task that has changes. Priority: must-have
- FR-028: Operator can continue a finished or failed task. Priority: must-have
- FR-029: Operator can pin and archive a task. Priority: must-have
- FR-030: Operator can cancel a scheduled auto-resume on a failed task. Priority: nice-to-have
- FR-031: Operator can read the task's diff, file by file, read-only. Priority: must-have
  > Socrates: Counter-argument considered — "a diff on a 390 px screen is unreadable, so
  > the cockpit gets opened anyway; a file list plus diffstat would carry the decision."
  > Resolution: stands as written. Accepting a review without seeing the change is signing
  > blind, so the diff has to be legible on the phone.
- FR-032: Every action shows that it is in flight, and on failure shows the reason the server gave rather than a generic message. Priority: must-have

### Starting work

- FR-033: Operator can start a new task by choosing a project, describing the work, picking a workflow and runner, and setting the autonomous toggle. Priority: nice-to-have
  > Socrates: Counter-argument accepted — "prompt quality drives the quality of the
  > agent's work; making it easy to fire off a three-sentence task from a tram may cost
  > more than it gives." Resolution: demoted to nice-to-have, consistent with the
  > operator's own phase-3 classification of this as a secondary outcome.
- FR-034: Operator lands in the new task's detail view straight after creating it. Priority: nice-to-have

### Being told

- FR-036: Operator can enable notifications from a deliberate tap in Settings. Priority: must-have
- FR-037: Operator is shown how to install the app instead of a permission prompt that cannot work, when running in Safari rather than standalone. Priority: must-have
- FR-038: Operator is notified when a task enters a state that needs them, told which task, which project, and why. Priority: must-have
- FR-039: Operator is not notified twice about the same transition, and a newer notification about a task replaces the older one. Priority: must-have
- FR-041: Tapping a notification opens that task's transcript, reusing an already-open window if there is one. Priority: must-have
- FR-042: Operator can see the number of tasks needing attention on the app icon without opening the app. Priority: nice-to-have
  > Socrates: Counter-argument accepted — "the badge only works once notifications are
  > granted, so it restates what the push already said, while requiring a counter kept
  > consistent between the app and the service worker — the classic source of 'badge says
  > three, nothing is waiting'." Resolution: demoted to nice-to-have.
- FR-043: A notification carries no code and no transcript content. Priority: must-have
- FR-044: A push subscription the push service reports as gone is dropped. Priority: must-have
- FR-045: Operator can send themselves a test notification to confirm the chain works end to end. Priority: nice-to-have

### Settings

- FR-046: Operator can choose the theme: follow system, dark, or light. Priority: must-have
- FR-047: Operator can see the app version and the Cezar version it is talking to. Priority: must-have
  > Socrates: Counter-argument accepted on half of a compound requirement — "this is my
  > VPS and my deploy, so I know when Cezar moves forward; the warning solves a problem I
  > do not have." Resolution: displaying both versions stays, since it is nearly free and
  > useful while debugging. The active warning when Cezar is newer than the tested version
  > is cut — see Non-Goals. The split was put to the operator at the cross-check and
  > confirmed.
- FR-048: Operator can jump from a task to the same task in the full cockpit. Priority: must-have

### Demoted during the Socratic round

- FR-049: Operator can load older transcript history by scrolling up past the most recent page. Priority: nice-to-have

Cut outright, and recorded in Non-Goals: the IndexedDB snapshot behind FR-002, camera
photo attachments (was FR-024), the Android share target (was FR-035), notification on
task completion (was FR-040), and the "Cezar is newer than tested" warning (was the second
half of FR-047).

## User Stories

### US-01: Operator answers a waiting agent from a locked phone

- **Given** a task is running on the operator's Cezar instance and the operator is away from their laptop with notifications enabled
- **When** the agent asks a question and the task enters `waiting`
- **Then** the phone shows a notification naming the task, its project and the reason; tapping it opens that task's transcript; the operator answers and the task leaves `waiting`

#### Acceptance Criteria
- The notification names the task and project and states why it needs attention; it carries no code and no transcript text
- Tapping the notification lands on that task's transcript, not on the list
- A second transition on the same task replaces the earlier notification rather than stacking
- The answer reaches the agent as a single message, and the transcript shows it
- If the app is not authorized at tap time, the operator lands on "Connect to Cezar" and, after authorizing, on the task they were sent to
- A task that finishes normally produces no notification at all

### US-02: Operator checks in and nothing needs them

- **Given** the operator has several tasks in flight across projects
- **When** they open the app from the home screen
- **Then** within three seconds they see every task, grouped with anything needing attention first, and can tell at a glance that nothing is waiting

#### Acceptance Criteria
- Status is conveyed by more than colour alone
- The live-connection state is visible, so a stale list is never mistaken for a quiet one
- With no network the app says so plainly, instead of a blank screen, a spinner that never resolves, or data it cannot vouch for
- Returning to the app after iOS froze it produces a current list, not the one from before the freeze

## Business Logic

**The product decides, for every task, whether it needs a human right now — and that one
decision drives the order of the list, whether a notification is sent, and what the icon
badge says.**

The rule consumes only what the operator could in principle see themselves: a task's
status, whether an agent is waiting on a question, whether it is merely watching its own
background work, and whether a failure is one the system has already scheduled to retry.
It resolves first-match-wins to a single answer per task — needs a human, or does not —
together with the reason, which is what the operator is actually told.

Two judgements in the rule are what make it more than a status label, and both are
deliberately counter-intuitive. A task that is running but only monitoring its own
background work does **not** need a human, even though it is plainly "active". A task that
has failed but carries a scheduled automatic retry does **not** need a human either, even
though "failed" is the loudest word on the screen — it is a scheduled task, not a broken
one. Getting either of these backwards produces notifications that train the operator to
ignore notifications, which destroys the product's only real value.

The operator encounters the rule three times over: as the top section of the list, as the
reason line inside a push notification, and as the number on the app icon. All three must
agree, always.

**Decision locked this phase: the rule is an exact copy of Cezar's, with one shared
implementation used by both the app and the push sidecar.** Two implementations that could
drift would eventually notify the operator about something the list does not show, which
is the worst failure this product can produce. The decision matches rule 8 of the project
`CLAUDE.md`. Explicitly rejected: quiet hours, and treating cost or duration overruns as
reasons to need a human — both would make the phone disagree with the cockpit.

## Non-Functional Requirements

All four candidate properties were confirmed binding, plus one for the sidecar. Each is
stated as something an outside observer can measure without inspecting the implementation.

- The task list is on screen within 3 seconds of tapping the home-screen icon, and a
  status change on the server is visible in the app within 2 seconds, on a phone on a
  normal mobile connection.
- Data the app cannot vouch for is never presented as live. After the operating system
  suspends and resumes the app, the operator either sees current state or sees state
  explicitly marked as not current — never yesterday's answer wearing today's face.
- Content produced by an agent never executes. Anything rendered from a transcript is
  text, whatever the agent generated and whatever was pasted into the issue that started
  the task.
- Status is legible without distinguishing colours, touch targets are at least 44 pt, and
  contrast meets AA in both themes.
- A notification is sent on a task *entering* a state that needs a human, never for a state
  it was already in. Restarting the notification service, or recovering a dropped
  connection, produces no notifications at all for work that was already waiting.

## Product framing

- **Product type: web-app**, delivered as an installable progressive web app. The primary
  surface is a home-screen icon on the operator's iPhone running in standalone mode with
  notifications. It is classified as a web app rather than as a mobile app deliberately:
  the label travels downstream to stack selection, and "mobile" there invites native
  mobile toolchains, which are the wrong answer for a single-operator tool. **No app store
  is involved** — installation is Safari's "Add to Home Screen", with no developer
  account, no review, and no signing. That is the reason the project is viable at all.
- A second, subordinate deliverable exists: a small always-on notification service on the
  same VPS. It is not a separate product — it has no user interface and exists solely so
  the app can be told things while it is closed — but it does carry its own operational
  cost (a service unit, keys, logs, upgrades), and phase 3's 12-week estimate includes it.
- **Scale: a single operator.** One person, one Cezar instance, one cookie. Traffic and
  data volume are whatever one person's agent runs produce.
  > Socrates probe (how would the domain rule change at 100x this scale?): the rule itself
  > would not change, but everything around it would — "needs a human" would have to
  > become "needs *which* human", notifications would need per-person routing, and the
  > shared attention implementation would need an owner concept it does not have today.
  > This is precisely why multi-user support is a Non-Goal rather than a deferred feature:
  > adding it later is a redesign, not an extension, and pretending otherwise would shape
  > the code wrongly from day one.
- **Timeline: 12 weeks, after-hours, no hard deadline.** Captured in phase 3 along with
  the explicit acknowledgment of the sustained-effort cost.

## Non-Goals

Carried over from `docs/REQUIREMENTS.md` §1, where the operator had already ruled them out:

- **No editing of workflows, skills, settings, or automations.** Authoring belongs in the
  cockpit; this product is for reacting to work already defined.
- **No project management or cloning.** Same reason.
- **No full Git or GitHub view.** A link to the pull request is the boundary.
- **No comparing task variants.** A desktop-sized comparison problem.
- **No command palette.** A keyboard affordance on a device with no keyboard.

Added during this session, each ruled out deliberately so it cannot creep back:

- **Cezar itself is never modified — not now, not later.** Everything on the server side is
  either nginx configuration or the separate notification service. Anything that would
  genuinely require a change inside Cezar is written up as a proposed upstream issue, not
  forked. This is the single most load-bearing non-goal: it is what forces same-origin
  hosting under `/m/` and a sidecar instead of a patched server.
- **No second user and no second Cezar instance — permanently, not "not yet".** This rules
  out an instance switcher, roles, and per-person notification routing. See the scale
  note above for why this is a design decision rather than a deferral.
- **No syntax highlighting in the diff.** Plain wrapped text. A highlighting library is the
  single largest item that could land in the app's size budget, and it buys legibility the
  operator did not ask for.
- **No background work of any kind except the push notification.** When the app is closed,
  the notification is the only channel. No background polling, no background sync, no
  connection held open. iOS would kill all of it anyway, and fighting that burns battery
  and weeks.
- **No Android support at all.** Not a secondary target, not "should not break" — untested
  and unclaimed. This removes the Android share target and a whole test pass from the
  final milestone. (Resolves Q4 of `docs/REQUIREMENTS.md` §9.)
- **No notification when a task merely finishes.** Only states that need a human produce a
  notification. Notifications that require no action teach the operator to ignore
  notifications, which destroys the one thing this product sells. (Resolves Q5.)
- **No persisted offline snapshot.** With no network the app says so plainly; it does not
  keep a local copy of task data to show later. Overrides F-PWA-4.
- **No camera attachments on messages.** Photographing something for an agent is a
  desk-side activity.
- **No warning when the server is newer than the version the app was tested against.** The
  operator controls both deploys, so it solves a problem they do not have.

Non-functional non-goals:

- **No offline-first guarantee.** The product is honest about being offline, not useful
  while offline.
- **No telemetry, analytics, or third-party services**, beyond the platform push service
  required to deliver a notification.

## Forward: tech-stack

Not part of the PRD. Captured here so the stack-selection step downstream can pick it up.

The operator has already committed to a stack in `docs/REQUIREMENTS.md` A8 — Vite, React
19, TypeScript in strict mode, Tailwind v4, TanStack Query, React Router, and a PWA plugin
in inject-manifest mode so the service worker can carry its own push handler — chosen to
match Cezar's own cockpit so components and theme tokens can be lifted across. The
notification service is specified as Node 20+ with Hono, a web-push library, and zod, with
no database. End-to-end testing is specified against WebKit to approximate mobile Safari.

Two dependencies named in that document are now questionable because of decisions made in
this session, and the stack step should revisit rather than inherit them: the IndexedDB
helper (the persisted snapshot was cut in the Socratic round) and the virtual-list library
(backwards paging through transcript history was demoted to nice-to-have). Neither may
still be needed.

Also relevant downstream: contract types are vendored from Cezar's repository pinned to a
commit, because the published packages are older prereleases than the server actually
running. That constraint is real and outlives any stack choice.

## Forward: technical-roadmap

Not part of the PRD. Deployment-shaped work the operator has already specified: an nginx
location block for `/m/` ordered ahead of the cockpit proxy plus one for the notification
service, a user-level service unit for that service, a build-and-sync deploy script, a
script to re-vendor the contract types at a given commit, a content security policy for
`/m/`, and HTTP/2 on the vhost (without it, the connection limit would starve the live
streams).

## Quality cross-check

Run on 2026-09-20. All five required elements present; no gaps to carry forward as
warnings. Status: accepted.

| Element | Result |
|---|---|
| Access Control | Present — nginx plus a cookie set from an access link; the boundary between what may change (the vhost) and what may not (Cezar) is explicit |
| Business Logic | Present — a single declarative rule, with the two counter-intuitive judgements inside it named |
| Project artifacts | Present — this file, with a valid checkpoint block |
| Timeline-cost acknowledged | Present — 12 weeks accepted deliberately over a scoped-down alternative, with a per-milestone breakdown |
| Non-Goals | Present — five carried from the source document, nine added and argued during this session |

Two observations recorded rather than resolved:

- **The 12-week estimate predates the Socratic cuts.** Backwards paging through transcript
  history, list virtualization, the persisted offline snapshot, Android support, camera
  attachments and the version warning were all removed after the estimate was made. That is
  roughly one and a half to two weeks of work, concentrated in the transcript milestone and
  the final polish milestone. The number was left at 12 rather than adjusted by the
  facilitator; it now carries slack.
- **The split of FR-047 was confirmed by the operator at cross-check.** Showing both
  version numbers stays a must-have; warning when the server is newer is cut.

## Open Questions

1. **What exactly does the cookie perimeter look like on the VPS?** The mechanism is
   settled (nginx plus a cookie set from an access link), but three details are not: the
   cookie's lifetime, whether the access link already accepts a return parameter so the
   operator lands back inside the installed app, and what the app actually receives when
   the cookie is missing or stale — a redirect, an HTML login page, or a status code.
   Owner: the operator, by reading the live vhost. Blocks: FR-004 and FR-005 cannot be
   designed without it, and they gate the first milestone that shows real data.
2. **Who owns the nginx vhost?** If it was generated by Cezar's own installer, a
   reinstall could overwrite the added location blocks; if it is an externally managed
   proxy, it will not. Owner: the operator. Blocks: nothing immediately, but it decides
   whether the deployment needs to be re-applicable after a Cezar upgrade. (This is Q2 of
   `docs/REQUIREMENTS.md` §9.)
3. **How does a permission request get answered?** Pending permission requests are the
   highest-priority attention state in the rule, yet `docs/CEZAR_API.md` §4 says the
   response mechanism has to be confirmed against Cezar's own cockpit routes before
   anything is built. It also notes these requests only appear when an approval gate is
   switched on, which may mean this state never occurs on this instance in practice.
   Owner: the operator, by checking the instance's configuration. Blocks: whether the
   top-priority branch of the domain rule is reachable at all.
4. **Does an icon badge actually work in an installed web app on this iPhone?** Platform
   support has historically been uneven. It is only a nice-to-have, so it blocks nothing —
   but it should be verified on the real device before any work goes into it, rather than
   after.

Questions from `docs/REQUIREMENTS.md` §9 resolved during this session: Q1 at the mechanism
level (see question 1 above for the residue), Q3 (more than eight registered projects), Q4
(Android is not a target at all), Q5 (notify only on states needing a human, never on
completion).
