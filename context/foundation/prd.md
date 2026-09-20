---
project: "Cezar Mobile"
version: 1
status: draft
created: 2026-09-20
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 12
  hard_deadline: null
  after_hours_only: true
---

# PRD — Cezar Mobile

Generated from `context/foundation/shape-notes.md` (2026-09-20). Content is transcribed
from that file; gaps are routed to `## Open Questions` rather than filled in.

Throughout this document, *task* is the unit of work the operator watches — the thing
Cezar starts, runs an agent against, and finishes.

## Vision & Problem Statement

A coding-agent orchestrator called Cezar runs on the operator's own server and drives
agents through long tasks. Those agents regularly stop and wait: a task enters `waiting`
because the agent asked a question, `review` because work is ready for acceptance, or
`failed`. Nothing surfaces that to the operator while they are away from their laptop, so
the task sits blocked for as long as it takes them to get back to a desk — calendar time
burned on something that needed a ten-second answer. Three distinct pains were confirmed
as co-existing, all real: **blocked tasks sit idle**, and delay-to-response is the
headline cost; there is **no situational awareness** — how many tasks are live, what they
cost, whether anything broke is unknown until the full cockpit is opened on a desktop; and
**the cockpit does not work under a thumb**, so even having it open on the phone is not a
usable surface for answering an agent.

The insight is an existence proof rather than a proprietary one, and the operator states
it directly: *"Pomysł został zrealizowany przez kogoś, ale nie mam do niego dostępu, tylko
dowiedziałem się, że można coś takiego zrobić jak PWA na iPhone z frameworkiem Cezar."*
Someone has already built a comparable phone client against Cezar; the operator has no
access to it and knows only that the shape is feasible. Feasibility risk is therefore low
and competitive advantage is nil — and irrelevant, because this is a tool for one person.
The alternative of making the existing cockpit itself installable was considered and
rejected: it would grant installability but neither a phone-first view nor notifications,
which are the two things that actually close the loop.

## User & Persona

**Primary persona — the operator.** A single named person: the owner of this Cezar
instance. One instance, one session, no role separation. Context: away from the desk,
phone in pocket, several agent tasks in flight. The moment they reach for this product is
the moment a notification tells them a task needs a human — or the moment they want to
know, in under three seconds, whether anything needs them at all.

No secondary persona. Multiple users and multiple Cezar instances are out of scope (see
`## Non-Goals`).

## Success Criteria

### Primary

- The operator receives a notification on a locked phone when a task enters a state that
  needs a human, taps it, lands in that task's transcript, answers the agent from the
  phone, and the task resumes — the whole loop closed without opening a laptop.
- Opening the home-screen icon shows the current state of every task across all projects,
  with the ones needing attention first, in under three seconds.

### Secondary

- The operator can start a new task from the phone.
- The operator can see what an agent changed and what it cost, from the phone.
- The app icon carries a badge with the number of tasks needing attention, so a glance at
  the home screen answers "does anything need me?" without opening anything.

Not counted as secondary, because it is a must-have: with no network the product says so
plainly rather than showing a blank screen (FR-002).

### Guardrails

All four were confirmed as hard — a failure here is a regression even if the primary
criteria hold.

- **No secret ever lands in the product's repository, its own storage, or its logs.** This
  covers the access link, the notification signing keys, and the operator's session.
- **Unrecognised data never breaks the view.** A transcript entry of a kind the product
  does not know, one carrying fields it has never seen, or an older recording renders
  generically or is skipped — never a blank screen. Cezar's vocabulary of transcript
  entries only ever grows.
- **A stale status is never presented as current.** Serving the operator a status they
  trust and that is no longer true is the worst failure mode available here, because it is
  silent.
- **No telemetry and no third-party services.** No analytics, no externally hosted assets.
  The only outbound traffic beyond the operator's own server is to the platform
  notification service required to reach a locked phone.

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
- If the product is not authorized at tap time, the operator lands on "Connect to Cezar" and, after authorizing, on the task they were sent to
- A task that finishes normally produces no notification at all

### US-02: Operator checks in and nothing needs them

- **Given** the operator has several tasks in flight across projects
- **When** they open the app from the home screen
- **Then** within three seconds they see every task, grouped with anything needing attention first, and can tell at a glance that nothing is waiting

#### Acceptance Criteria
- Status is conveyed by more than colour alone
- The live-connection state is visible, so a stale list is never mistaken for a quiet one
- With no network the product says so plainly, instead of a blank screen, a load that never resolves, or data it cannot vouch for
- Returning to the app after the phone suspended it produces a current list, not the one from before the suspension

## Functional Requirements

Transcribed from the operator's own requirement list, then put through a targeted Socratic
round. Priority maps from the source document's P-levels — P0 and P1 start as `must-have`
because the operator chose the full scope — and was then revised wherever a
counter-argument landed.

The Socratic round was run in targeted rather than exhaustive form by explicit agreement:
48 requirements would have meant roughly 12 rounds of questions, and decision fatigue
would have turned the later rounds into rubber-stamping. Ten requirements carrying a real
counter-argument were challenged; the rest are inherited unchallenged. Numbering has gaps
where a requirement was cut — the gaps are deliberate, so the Socratic record below stays
readable.

### Installation and shell

- FR-001: Operator can install the product to the phone's home screen and launch it from that icon as a full-screen app. Priority: must-have
- FR-002: Operator can open the app with no network and see a clear offline state rather than a blank screen or a load that never resolves. Priority: must-have
  > Socrates: Counter-argument accepted — "a phone is almost always online, and hour-old
  > data can mislead more than its absence; a readable message costs an hour, keeping a
  > local copy costs days plus a new class of staleness bugs." Resolution: the persisted
  > snapshot is dropped. This overrides the source document's F-PWA-4, which called for a
  > persisted local snapshot at P0.
- FR-003: Operator can accept a new version of the app deliberately, rather than having it swap underneath them mid-use. Priority: must-have

### Access

- FR-004: Operator can tell from inside the installed app that it is not authorized, and is shown a "Connect to Cezar" screen instead of an error or an empty list. Priority: must-have
- FR-005: Operator can complete authorization from inside the installed app and land back on the task list. Priority: must-have
- FR-006: Operator can sign out, which clears everything the app holds locally and stops notifications reaching this device. Priority: must-have

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
  > phone without one.

### Task detail

- FR-014: Operator can see a task's header: status, workflow, step progress, runner and model, cost, tokens, branch, PR link. Priority: must-have
- FR-015: Operator can read the most recent stretch of a task's transcript. Priority: must-have
  > Socrates: Counter-argument accepted — "on a phone I care about what the agent is doing
  > now and what it is asking, not archaeology from an hour ago." Resolution: paging
  > backwards through history leaves the must-have set — only the latest page is required,
  > which also removes the need to keep an arbitrarily long transcript smooth. Resuming
  > after a suspension (FR-021) was explicitly kept. The demoted remainder is FR-049. This
  > is the largest scope cut of the session.
- FR-016: Operator can watch the transcript update live while the agent works. Priority: must-have
- FR-017: Operator can read agent messages as formatted text, sees tool calls collapsed to one line, and can expand one to inspect its input and output. Priority: must-have
- FR-018: Operator can see the agent's current plan as a checklist pinned above the transcript. Priority: must-have
- FR-019: Operator can stay where they scrolled, with a "new messages" affordance instead of being yanked to the bottom. Priority: must-have
- FR-020: Opening a task marks it read. Priority: must-have
- FR-021: Operator can return to the app after the phone froze it and resume the transcript with nothing lost and nothing duplicated. Priority: must-have

### Acting on a task

- FR-022: Operator can answer an agent's question by picking from the offered options or writing their own answer. Priority: must-have
- FR-023: Operator can send a free-text message to a running or waiting task. Priority: must-have
- FR-025: Operator can cancel a running or queued task, behind a confirmation. Priority: must-have
  > Socrates: Counter-argument considered across FR-025 to FR-029 — "housekeeping actions
  > will happily wait for a laptop." Resolution: every action in the set was kept as
  > must-have, including the housekeeping ones. Cancel, finish and continue each close the
  > loop for one of the notification reasons; the operator judged draft-PR, pin and archive
  > worth having under a thumb as well.
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
  > operator's own classification of this as a secondary outcome.
- FR-034: Operator lands in the new task's detail view straight after creating it. Priority: nice-to-have

### Being told

- FR-036: Operator can enable notifications from a deliberate tap in Settings. Priority: must-have
- FR-037: Operator is shown how to install the product instead of a permission prompt that cannot work, when viewing it in a browser tab rather than from the installed icon. Priority: must-have
- FR-038: Operator is notified when a task enters a state that needs them, told which task, which project, and why. Priority: must-have
- FR-039: Operator is not notified twice about the same transition, and a newer notification about a task replaces the older one. Priority: must-have
- FR-041: Tapping a notification opens that task's transcript, reusing an already-open window if there is one. Priority: must-have
- FR-042: Operator can see the number of tasks needing attention on the app icon without opening the app. Priority: nice-to-have
  > Socrates: Counter-argument accepted — "the badge only works once notifications are
  > granted, so it restates what the notification already said, while requiring a counter
  > kept consistent between the app and whatever updates it while the app is closed — the
  > classic source of 'badge says three, nothing is waiting'." Resolution: demoted to
  > nice-to-have.
- FR-043: A notification carries no code and no transcript content. Priority: must-have
- FR-044: A notification destination the platform reports as gone is dropped, so nothing keeps targeting a device the operator no longer has the product on. Priority: must-have
- FR-045: Operator can send themselves a test notification to confirm the chain works end to end. Priority: nice-to-have

### Settings

- FR-046: Operator can choose the theme: follow system, dark, or light. Priority: must-have
- FR-047: Operator can see the product's version and the Cezar version it is talking to. Priority: must-have
  > Socrates: Counter-argument accepted on half of a compound requirement — "this is my
  > server and my deploy, so I know when Cezar moves forward; the warning solves a problem
  > I do not have." Resolution: displaying both versions stays, since it is nearly free and
  > useful while debugging. The active warning when Cezar is newer than the tested version
  > is cut — see Non-Goals. The split was put to the operator at the cross-check and
  > confirmed.
- FR-048: Operator can jump from a task to the same task in the full cockpit. Priority: must-have

### Demoted during the Socratic round

- FR-049: Operator can load older transcript history by scrolling up past the most recent page. Priority: nice-to-have

Cut outright, and recorded in Non-Goals: the persisted offline snapshot behind FR-002,
camera photo attachments (was FR-024), the Android share target (was FR-035), notification
on task completion (was FR-040), and the "Cezar is newer than tested" warning (was the
second half of FR-047).

## Non-Functional Requirements

All four candidate properties were confirmed binding, plus one covering notifications.
Each is stated as something an outside observer can measure without inspecting the
implementation.

- The task list is on screen within 3 seconds of tapping the home-screen icon, and a
  status change on the server is visible in the app within 2 seconds, on a phone on a
  normal mobile connection.
- Data the product cannot vouch for is never presented as live. After the operating system
  suspends and resumes the app, the operator either sees current state or sees state
  explicitly marked as not current — never yesterday's answer wearing today's face.
- Content produced by an agent never executes. Anything rendered from a transcript is
  text, whatever the agent generated and whatever was pasted into the issue that started
  the task.
- Status is legible without distinguishing colours, touch targets are at least 44 pt, and
  contrast meets AA in both themes.
- A notification is sent on a task *entering* a state that needs a human, never for a state
  it was already in. An interruption on the product's side — a restart, or a dropped and
  recovered connection — produces no notifications at all for work that was already
  waiting when it happened.

## Business Logic

**For every task, the product decides whether it needs a human right now — and that one
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
reason line inside a notification, and as the number on the app icon. All three must
agree, always — and all three must agree with the full cockpit, because the rule is an
exact copy of the one Cezar already applies in its own interface. A phone that disagrees
with the cockpit about what needs attention is the worst failure this product can produce.
Explicitly rejected for that reason: quiet hours, and treating cost or duration overruns
as reasons a task needs a human — both would make the phone disagree with the cockpit.

## Access Control

Single operator; no application-level authentication of the product's own.

Cezar ships no authentication. Access is granted by a perimeter in front of it, which
issues the operator a session when they visit an access link. The product therefore never
implements a login: it detects the *absence* of a valid session and hands the operator
back to the perimeter.

- **No role separation.** One person, one session, one Cezar instance. Every route the
  operator can reach in the full cockpit, they can reach here.
- **The perimeter's configuration is in scope for change; Cezar is not.** If the access
  link cannot return the operator to the installed app once the session exists, that is
  fixed in the perimeter. Anything that would require changing Cezar is written up as a
  proposed upstream issue instead.
- **Unauthenticated behaviour.** The product's static shell carries no data and is
  reachable without a session, so installation works before the session exists. Everything
  that carries task data requires it. A data request that comes back refused — or as a
  login page instead of data — puts the app on the "Connect to Cezar" screen rather than
  showing a broken list.
- **No credential is ever held by the product.** The access link is never written into the
  product's own storage, its logs, or its repository; the session lives in the browser's
  own keeping, not in application state.

### Perimeter facts, verified on the live instance (2026-09-20)

Measured directly against the running gateway. These are constraints the product must
design around, not choices it can revisit. Mechanics are recorded in `docs/CEZAR_API.md` § 1a.

- **The session lasts 30 days and does not slide.** The clock starts when the operator
  opens the access link and expires on schedule regardless of use. Only a hit carrying the
  access parameter issues a session; ordinary requests never extend one.
- **The product can never inspect the session.** It is held in a form the application's own
  code cannot read, so the product cannot check how long is left, cannot renew it, and
  cannot warn the operator in advance. The only signal available is a refusal, in flight.
  This closes off any "your access expires soon" affordance — the operator finds out by
  being refused.
- **A missing or stale session produces a bare refusal.** No redirect, no login page, no
  challenge header — a small static error page, identical for reads, writes, streams and
  deep links. The product therefore detects refusal and offers re-unlocking; it never
  implements, and never simulates, a login.
- **The access link cannot carry a return destination.** Everything but the path is
  discarded on the way through. A return target can only be encoded in the link's path, and
  the product cannot build such a link anyway, because it would contain the secret.
- **The installable shell must sit outside the gate.** An installed app on the phone keeps
  its own cookies, separate from the browser it was installed from, so launching from the
  icon arrives with no session. If the shell itself were gated, the operator would receive
  the gateway's error page *at the app's own address* and there would be no application
  loaded to show "Connect to Cezar" at all — FR-004 becomes unreachable. Only the data
  surface is gated. This makes the existing "static shell reachable without a session" rule
  a deployment requirement rather than an observation.
- **Live updates have exactly one available transport.** The event stream passes the
  gateway; socket upgrades do not, because the gateway does not forward them. This is a
  property of the deployment, not a product preference, and it is not negotiable from the
  product's side.

## Non-Goals

Carried over from the source requirements, where the operator had already ruled them out:

- **No editing of workflows, skills, settings, or automations.** Authoring belongs in the
  cockpit; this product is for reacting to work already defined.
- **No project management or cloning.** Same reason.
- **No repository browsing.** A link out to the pull request is the boundary.
- **No comparing task variants.** A desktop-sized comparison problem.
- **No command palette.** A keyboard affordance on a device with no keyboard.

Added during shaping, each ruled out deliberately so it cannot creep back:

- **Cezar itself is never modified — not now, not later.** Anything that would genuinely
  require a change inside Cezar is written up as a proposed upstream issue, not forked.
  This is the single most load-bearing non-goal: it constrains where the product may be
  hosted, and forces every need on the server to be met beside Cezar rather than inside it.
- **No second user and no second Cezar instance — permanently, not "not yet".** This rules
  out an instance switcher, roles, and per-person notification routing. At a hundred times
  this scale the domain rule itself would not change, but everything around it would:
  "needs a human" would have to become "needs *which* human". Adding that later is a
  redesign, not an extension, and pretending otherwise would shape the product wrongly from
  day one.
- **No syntax highlighting in the diff.** Plain wrapped text. It is the single largest item
  that could land in the product's size budget, and it buys legibility the operator did not
  ask for.
- **No background work of any kind except the notification.** When the app is closed, the
  notification is the only channel. No background polling, no background sync, no
  connection held open. The phone would kill all of it anyway, and fighting that burns
  battery and weeks.
- **No Android support at all.** Not a secondary target, not "should not break" — untested
  and unclaimed. This removes the Android share target and a whole test pass from the final
  milestone.
- **No notification when a task merely finishes.** Only states that need a human produce a
  notification. Notifications that require no action teach the operator to ignore
  notifications, which destroys the one thing this product sells.
- **No persisted offline snapshot.** With no network the product says so plainly; it does
  not keep a local copy of task data to show later.
- **No camera attachments on messages.** Photographing something for an agent is a
  desk-side activity.
- **No warning when Cezar is newer than the version the product was tested against.** The
  operator controls both deploys, so it solves a problem they do not have.
- **No app-store distribution.** Installation is from the phone's browser to the home
  screen: no developer account, no review, no signing. That is the reason this project is
  viable at all.

Non-functional non-goals:

- **No offline-first guarantee.** The product is honest about being offline, not useful
  while offline.
- **No telemetry, analytics, or third-party services**, beyond the platform notification
  service required to deliver a notification.

## Open Questions

1. ~~**What exactly does the access perimeter look like in front of Cezar?**~~
   **RESOLVED 2026-09-20** by reading the live configuration. All three sub-questions are
   answered: the session lasts 30 days and does not slide; the access link does **not**
   accept a return parameter, and discards everything but the path; a missing or stale
   session yields a **bare refusal** — no redirect, no login page. Recorded in
   `## Access Control` → *Perimeter facts*, with mechanics in `docs/CEZAR_API.md` § 1a.
   FR-004 and FR-005 are unblocked, and their shape is now fixed: detect the refusal, offer
   re-unlocking. One consequence was not anticipated when this question was written — the
   installable shell must be served outside the gate, or FR-004 has no application in which
   to render itself. That is now a deployment requirement.
2. **Who owns the perimeter's configuration?** If it was generated by Cezar's own
   installer, a reinstall could overwrite what this product adds to it; if it is externally
   managed, it will not. Owner: the operator. Blocks: nothing immediately, but it decides
   whether the deployment needs to be re-applicable after a Cezar upgrade.
3. ~~**How does a permission request get answered?**~~
   **RESOLVED 2026-09-20** — it cannot be, because the state never occurs. The approval
   gate is off, the runner starts in a mode that refuses rather than asks, and the event
   itself is a reserved type with no emitter anywhere in the running code. Switching the
   gate on would **not** revive it: that only changes the agent's permission mode, and
   Cezar still carries no code turning a tool-approval request into an event the interface
   can see. Reviving this path is a change inside Cezar, which is a permanent non-goal —
   it belongs upstream as a proposed issue. Evidence in `docs/CEZAR_API.md` § 5a.

   The branch **stays in the product's copy of the attention rule.** The rule is required
   to be an exact copy of Cezar's, the event vocabulary only ever grows, and deleting the
   branch would put the phone at odds with the cockpit on the very day Cezar wires the
   emitter. It is treated as unreachable, not as absent: no UI for answering a permission
   request, no end-to-end coverage, and a unit test holding the copy faithful to the
   original.
4. **Does an icon badge actually work in an installed web app on this phone?** Platform
   support has historically been uneven. It is only a nice-to-have, so it blocks nothing —
   but it should be verified on the real device before any work goes into it, rather than
   after.
5. **Is 12 weeks still the right number?** The estimate predates the Socratic cuts:
   backwards paging through transcript history, keeping a very long transcript smooth, the
   persisted offline snapshot, Android support, camera attachments and the version warning
   were all removed after it was made — roughly one and a half to two weeks of work,
   concentrated in the transcript and final-polish milestones. The estimate was left at 12
   rather than adjusted, so `timeline_budget.mvp_weeks` currently carries slack. Owner: the
   operator. Blocks: nothing; it affects planning honesty, not scope.

Questions resolved during shaping and recorded here so they are not reopened: the access
mechanism at the mechanism level (see question 1 for the residue), the project count (more
than eight registered projects, so the project filter stays must-have), Android (not a
target at all), and notification policy (notify only on states needing a human, never on
completion).
