---
project: "Cezar Mobile"
version: 1
status: draft
created: 2026-09-20
updated: 2026-09-20
prd_version: 1
main_goal: low-complexity
top_blocker: capacity
---

# Roadmap: Cezar Mobile

> Derived from `context/foundation/prd.md` (v1) + a codebase baseline inventoried on 2026-09-20.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Agents running on the operator's own Cezar instance stop and wait — for an answer, for a
review, or because they failed — and nothing reaches the operator while they are away from
their laptop, so the task sits idle for as long as it takes to get back to a desk. This
product is a phone client that closes that loop: it tells the operator a task needs them,
lands them in that task, and lets them answer under a thumb.

One person, one instance, no login of its own. The product never modifies Cezar; anything
the server needs is built beside it.

## North star

**S-03: Operator opens the icon and sees every task, attention first** — the smallest
end-to-end slice that proves the whole chain works: perimeter session → Cezar's API → the
attention rule → a readable phone screen.

> "North star" here means the smallest end-to-end slice whose delivery would prove the
> product's core idea holds — placed as early as its prerequisites allow, because
> everything after it only matters if this works. It is not the most valuable slice
> (that is the notification loop, S-10); it is the earliest slice that proves the idea is
> real, and every later slice builds on the data path it establishes.

## At a glance

| ID   | Change ID                  | Outcome (user can …)                                            | Prerequisites | PRD refs                                    | Status   |
| ---- | -------------------------- | --------------------------------------------------------------- | ------------- | ------------------------------------------- | -------- |
| F-01 | `serve-shell-at-perimeter` | (foundation) the built shell is served at `/m/`, outside the gate | —             | Access Control §Perimeter facts, FR-001      | ready    |
| F-02 | `vendor-cezar-contract`    | (foundation) contract pinned to the running Cezar version        | —             | Guardrails, Business Logic                   | ready    |
| S-01 | `install-to-home-screen`   | install to the home screen, launch full-screen, update on purpose | F-01          | FR-001, FR-002, FR-003                       | proposed |
| S-02 | `connect-to-cezar`         | see they are not authorized and re-unlock the app                 | F-01          | FR-004, FR-005                               | implemented |
| S-03 | `task-list`                | see every task across projects, attention first                   | F-02, S-02    | US-02, FR-007, FR-008, FR-009, FR-011, FR-013 | proposed |
| S-04 | `live-status`              | watch status change without refreshing, and trust it              | S-03          | US-02, FR-010, FR-012                        | proposed |
| S-05 | `read-transcript`          | read a task's header and its most recent transcript               | S-03, F-02    | US-01, FR-014, FR-015, FR-017, FR-018, FR-020 | proposed |
| S-06 | `transcript-stays-live`    | watch the transcript live and resume it after the phone freezes   | S-04, S-05    | US-01, FR-016, FR-019, FR-021                | proposed |
| S-07 | `answer-the-agent`         | answer an agent's question or send it a message                   | S-05          | US-01, FR-022, FR-023, FR-032                | proposed |
| S-08 | `act-on-a-task`            | cancel, finish, continue, open a draft PR, pin and archive        | S-05          | FR-025, FR-026, FR-027, FR-028, FR-029       | proposed |
| S-09 | `read-the-diff`            | read what the agent changed, file by file                         | S-05          | FR-031                                       | proposed |
| S-10 | `notify-and-deep-link`     | be notified on a locked phone and land in that task               | F-01, S-05    | US-01, FR-036, FR-037, FR-038, FR-041, FR-043 | proposed |
| S-11 | `notifications-stay-honest` | trust that notifications never repeat or target a dead device     | S-10          | FR-039, FR-044                               | proposed |
| S-12 | `settings-and-sign-out`    | set the theme, see both versions, jump to the cockpit, sign out   | S-03, S-10    | FR-006, FR-046, FR-047, FR-048               | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still
lives in the dependency graph below; this table is the proposed reading order across
parallel tracks.

| Stream | Theme                 | Chain                                          | Note                                                                                  |
| ------ | --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| A      | Getting on the phone  | `F-01` → `S-01` / `S-02`                       | Mostly operator-side server work; runs in parallel with Stream B.                      |
| B      | Awareness             | `F-02` → `S-03` → `S-04`                       | Carries the north star. `S-03` joins Stream A at `S-02`.                               |
| C      | The loop              | `S-05` → `S-06` / `S-07` / `S-08` / `S-09`     | Three independent branches off `S-05`; the smallest goal is `S-07`.                    |
| D      | Being told, and settling | `S-10` → `S-11` → `S-12`                    | `S-10` joins Stream C at `S-05`; it is the headline value but needs a task screen first. |

## Baseline

What is already in place as of 2026-09-20. Foundations below assume these are present and
do NOT re-scaffold them.

- **Frontend:** partial — React 19 + Vite 8 + Tailwind v4 shell; router and server-state
  providers wired in `apps/pwa/src/main.tsx`; no feature screens exist.
- **Backend / API client:** absent — no `apps/pwa/src/api/`; no HTTP wrapper, no event-stream manager.
- **Domain rule:** present — the attention rule and its table tests live in
  `packages/shared/src/attention.ts`. This is the product's central rule and it is done.
- **Contract:** partial — `packages/cezar-contract/` exists as a slot; `src/` is empty
  until `npm run sync:contract <sha>` runs.
- **Auth:** ~~absent — no "Connect to Cezar" screen.~~ **present as of 2026-09-20** —
  `apps/pwa/src/api/http.ts` (refusal detection), `apps/pwa/src/domain/access-link.ts` and
  `apps/pwa/src/features/auth/` (the gate, the screen, the unlock). S-03 renders inside the
  gate rather than adding one.
- **Notifications:** partial — the service worker carries `push` and `notificationclick`
  handlers; the sidecar is still a placeholder that serves "Hello Hono!".
- **Deploy / infra:** ~~present but **not applied** — CI, deploy-on-merge, an nginx snippet
  with a guarded installer, and a systemd unit all exist in the repo. None of it has
  touched the live host: `/m/` currently answers 403 from the gate.~~
  **Out of date as of 2026-09-20 20:22.** Measured against the running gateway with no
  cookies: `GET /m/` → **200**, `GET /` (cockpit) → **403**. The shell is served outside
  the gate and the cockpit is not, which is F-01's requirement — so **F-01 is applied** and
  deploy-on-merge is live (it shipped S-01 via PR #10). The systemd unit for the push
  sidecar is a separate question and was not checked.
- **Observability:** absent, and deliberately so — the PRD forbids telemetry and
  third-party services.

## Foundations

### F-01: Shell served from the real deployment path

- **Outcome:** (foundation) the built shell is served at `https://cezar.ciey.studio/m/`
  from outside the gate, and merges to `main` reach it without a manual step.
- **Change ID:** `serve-shell-at-perimeter`
- **PRD refs:** Access Control §Perimeter facts ("The installable shell must sit outside
  the gate"), FR-001
- **Unlocks:** S-01, S-02, and the verification path for every other slice — nothing in
  this roadmap can be checked on the real device until this lands. Also the host the
  notification service will sit beside (S-10).
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:**
  - Does the vhost hold exactly one `location /` block? The installer refuses to guess
    when there is more than one. — Owner: operator. Block: no.
- **Risk:** First because it is the only slice that is pure server work, so it can proceed
  while agent-side work runs in parallel. The perimeter facts make this load-bearing
  rather than cosmetic: if the shell were gated, the operator would get the gateway's
  error page at the app's own address and FR-004 would have no application to render in.
- **Status:** ready

### F-02: Contract vendored at the running Cezar version

- **Outcome:** (foundation) the schemas and the agent-event vocabulary are vendored at the
  commit matching the instance, and fixtures are validated against them.
- **Change ID:** `vendor-cezar-contract`
- **PRD refs:** Guardrails ("Unrecognised data never breaks the view"), Business Logic
- **Unlocks:** S-03 and S-05 — every slice that parses task data. Also the guardrail that
  an unknown transcript entry renders generically instead of blanking the view: without a
  pinned vocabulary there is nothing to be "unknown" relative to.
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - Which commit matches the version the instance reports? — Owner: operator. Block: no.
- **Risk:** Cheap and entirely repo-side, which makes it the right thing to hand an agent
  while F-01 waits on the operator's server access. The failure mode if skipped is
  late rather than loud: hand-written types drift from the server and the drift surfaces
  as a blank screen on the phone, which is exactly the guardrail this project treats as
  non-negotiable.
- **Status:** ready

## Slices

### S-01: Install to the home screen

- **Outcome:** Operator can install the product to the phone's home screen, launch it
  full-screen from the icon, see a plain offline state when there is no network, and accept
  a new version deliberately rather than having it swap mid-use.
- **Change ID:** `install-to-home-screen`
- **PRD refs:** FR-001, FR-002, FR-003
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The shell already carries the manifest, the icons and the update prompt, so
  this slice is mostly verification on the real device — which is the point: it is the
  first moment anything is confirmed on the actual phone rather than in a headless browser.
- **Status:** proposed
- **Note (2026-09-20):** implemented and deployed via PR #10
  (`context/changes/install-to-home-screen/`). The offline state and the install hint were
  the real gaps; the update prompt only needed tests. Left as `proposed` rather than moved
  to Done because the outcome's own premise — confirmation on an actual phone — has not
  happened: the Share sheet, a real home-screen launcher and Airplane Mode all still need
  the device. Everything reachable from WebKit against the live host is verified and
  recorded in that change's `plan.md` § Progress. Archive it once the device pass is done.

### S-02: Connect to Cezar

- **Outcome:** Operator can tell from inside the installed app that it is not authorized,
  is shown "Connect to Cezar" instead of an error or an empty list, and can re-unlock it.
- **Change ID:** `connect-to-cezar`
- **PRD refs:** FR-004, FR-005
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** Resolution of Open Roadmap Question 1 (a perimeter decision, not a code one).
- **Unknowns:**
  - FR-005 requires landing back on the task list after authorizing, but the perimeter
    discards everything but the path and the product cannot build a return link without
    embedding the secret. Does the perimeter admit a return path, or does FR-005 reduce to
    "the operator re-opens the icon by hand"? — Owner: operator. Block: yes.
- **Risk:** Blocked on a contradiction the PRD does not resolve: FR-005 promises a return
  that the recorded perimeter facts say the product cannot produce on its own. Planning
  this slice before the question is answered would produce a plan for one of two different
  products. Detecting the refusal (FR-004) is unaffected and could be split out if the
  question stays open.
- **Status:** ~~blocked~~ implemented 2026-09-20 (`context/changes/connect-to-cezar/`)
- **Note (2026-09-20):** the blocker dissolved rather than being answered. Open Roadmap
  Question 1 asked whether the perimeter admits a return path; the answer is that it admits
  one *in the path* — the guard's `return 302 https://$host$uri` keeps the path and drops
  the query — so the app rewrites the pasted link's path to `/m/` and the return target
  needs no perimeter change. Whether the guard is reached at `/m/` at all is still unknown
  from the client (see § Open Roadmap Questions 1), so the slice ships **both** shapes: the
  one-paste unlock, and — when the gateway ignores the key — a stripped URL plus "open it in
  Safari and come back", which the visibility re-probe completes with nothing pressed. The
  question is now a verification step on the device, not a fork in the design.

### S-03: The task list

- **Outcome:** Operator can open the icon and see every task across all registered
  projects, grouped with anything needing attention first, each row readable without
  opening it, refreshable by pulling and on returning to the app, and filterable by project.
- **Change ID:** `task-list`
- **PRD refs:** US-02, FR-007, FR-008, FR-009, FR-011, FR-013
- **Prerequisites:** F-02, S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The north star, and the first slice that is useful on its own. It is also
  where the attention rule stops being a tested function and starts being the thing the
  operator reads, so a disagreement with the cockpit becomes visible here first — which
  the PRD names as the worst failure this product can produce.
- **Status:** proposed

### S-04: Live status

- **Outcome:** Operator can see status changes appear without refreshing and without the
  list jumping, and can tell whether the live connection is healthy, reconnecting, or lost.
- **Change ID:** `live-status`
- **PRD refs:** US-02, FR-010, FR-012
- **Prerequisites:** S-03
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Split from S-03 deliberately. A list that refetches on foreground already
  satisfies most of US-02; liveness is what makes it trustworthy, and the connection
  indicator is what stops a stale list being mistaken for a quiet one. Sequenced right
  after the list because the guardrail it serves — never presenting a stale status as
  current — is the one the PRD calls the worst failure mode, since it is silent.
- **Status:** proposed

### S-05: Read a task's transcript

- **Outcome:** Operator can open a task and read its header — status, workflow, step
  progress, runner and model, cost, tokens, branch, PR link — plus the most recent stretch
  of its transcript, with agent messages as formatted text, tool calls collapsed to one
  line and expandable, and the agent's current plan pinned above. Opening it marks it read.
- **Change ID:** `read-transcript`
- **PRD refs:** US-01, FR-014, FR-015, FR-017, FR-018, FR-020
- **Prerequisites:** S-03, F-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The transcript reducer is the most intricate piece of pure logic in the
  product and the place where the append-only vocabulary guardrail is enforced in anger.
  Only the latest page is required — paging backwards was cut — which keeps this slice
  from absorbing the whole middle of the roadmap.
- **Status:** proposed

### S-06: The transcript stays live and survives suspension

- **Outcome:** Operator can watch the transcript update while the agent works, stay where
  they scrolled with a "new messages" affordance instead of being yanked to the bottom, and
  return after the phone froze the app with nothing lost and nothing duplicated.
- **Change ID:** `transcript-stays-live`
- **PRD refs:** US-01, FR-016, FR-019, FR-021
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Resume-after-suspension is the single hardest correctness problem here: the
  phone freezes the app at will, and "nothing lost and nothing duplicated" has to hold
  across a dropped stream. Sequenced after both the live transport (S-04) and the reducer
  (S-05) because it is the join of the two.
- **Status:** proposed

### S-07: Answer the agent

- **Outcome:** Operator can answer an agent's question by picking from the offered options
  or writing their own, and can send a free-text message to a running or waiting task.
  Every action shows it is in flight and, on failure, the reason the server gave.
- **Change ID:** `answer-the-agent`
- **PRD refs:** US-01, FR-022, FR-023, FR-032
- **Prerequisites:** S-05
- **Parallel with:** S-06, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the half of the headline loop that does not need notifications — after
  it lands, the operator can already close a waiting task from the phone, just without
  being told to. Sequenced ahead of the housekeeping actions because it is the one that
  answers the product's reason for existing.
- **Status:** proposed

### S-08: Act on a task

- **Outcome:** Operator can cancel a running or queued task behind a confirmation, accept
  and finish a task in review, open a draft PR for a reviewed task with changes, continue
  a finished or failed task, and pin or archive a task.
- **Change ID:** `act-on-a-task`
- **PRD refs:** FR-025, FR-026, FR-027, FR-028, FR-029
- **Prerequisites:** S-05
- **Parallel with:** S-06, S-07, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The PRD kept all of these as must-have against the counter-argument that
  housekeeping can wait for a laptop; cancel, finish and continue each close the loop for
  one of the notification reasons, so they are not optional decoration.
- **Status:** proposed

### S-09: Read the diff

- **Outcome:** Operator can read a task's diff, file by file, read-only, with lines
  wrapped and no syntax highlighting.
- **Change ID:** `read-the-diff`
- **PRD refs:** FR-031
- **Prerequisites:** S-05
- **Parallel with:** S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Its own slice because the PRD argued it specifically and kept it: accepting a
  review without seeing the change is signing blind. The size budget is the thing to watch —
  highlighting is a non-goal precisely because it is the largest thing that could land here.
- **Status:** proposed

### S-10: Be notified, and land in the task

- **Outcome:** Operator can enable notifications from a deliberate tap in Settings, is
  shown how to install the product instead of a permission prompt that cannot work when
  viewing it in a browser tab, is notified when a task enters a state that needs them —
  told which task, which project and why, with no code and no transcript content — and
  tapping the notification opens that task's transcript, reusing an already-open window.
- **Change ID:** `notify-and-deep-link`
- **PRD refs:** US-01, FR-036, FR-037, FR-038, FR-041, FR-043
- **Prerequisites:** F-01, S-05
- **Parallel with:** S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Does the whole notification chain survive on the real device with the app closed? The
    simulator cannot answer this. — Owner: operator. Block: no.
- **Risk:** The headline value, and the most infrastructure-heavy slice: it needs a real
  service running beside Cezar, signing keys held off the repo, and a device test that no
  simulator substitutes for. Sequenced after S-05 because a notification that deep-links
  into a screen that does not exist is worse than no notification. The event-emitting half
  of the loop is already proven by S-04's transport, which de-risks the hardest half.
- **Status:** proposed

### S-11: Notifications stay honest

- **Outcome:** Operator is not notified twice about the same transition, a newer
  notification about a task replaces the older one, and a destination the platform reports
  as gone is dropped so nothing keeps targeting a device the product is no longer on.
- **Change ID:** `notifications-stay-honest`
- **PRD refs:** FR-039, FR-044
- **Prerequisites:** S-10
- **Parallel with:** S-12
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Split from S-10 because it is a different kind of work — transition bookkeeping
  that has to survive the service restarting and its connection dropping, rather than
  delivery. The requirement that a reconnect produces no notifications for work that was
  already waiting is the one that protects the product's only real value: notifications
  that require no action teach the operator to ignore notifications.
- **Status:** proposed

### S-12: Settings and sign-out

- **Outcome:** Operator can choose the theme, see both the product's version and the Cezar
  version it is talking to, jump from a task to the same task in the full cockpit, and sign
  out — clearing everything held locally and stopping notifications reaching this device.
- **Change ID:** `settings-and-sign-out`
- **PRD refs:** FR-006, FR-046, FR-047, FR-048
- **Prerequisites:** S-03, S-10
- **Parallel with:** S-11
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Last because sign-out is only fully meaningful once there is both local state
  and a notification subscription to tear down; doing it earlier would mean revisiting it.
  Nothing here is hard, which makes it the natural place to absorb slippage.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                  | Ready for `/10x-plan` | Notes                                             |
| ---------- | --------------------------- | ------------------------------------------------------ | --------------------- | ------------------------------------------------- |
| F-01       | `serve-shell-at-perimeter`  | Serve the shell at /m/ outside the gate                 | yes                   | Mostly operator-side server work                  |
| F-02       | `vendor-cezar-contract`     | Vendor the Cezar contract at the running version        | yes                   | Run `/10x-plan vendor-cezar-contract`             |
| S-01       | `install-to-home-screen`    | Install to the home screen and update on purpose        | no                    | Needs F-01                                        |
| S-02       | `connect-to-cezar`          | Detect a missing session and offer re-unlocking         | no                    | Blocked — Open Roadmap Question 1                 |
| S-03       | `task-list`                 | Task list across projects, attention first              | no                    | North star; needs F-02 and S-02                   |
| S-04       | `live-status`               | Live status updates and connection health               | no                    | Needs S-03                                        |
| S-05       | `read-transcript`           | Task header and most recent transcript                  | no                    | Needs S-03, F-02                                  |
| S-06       | `transcript-stays-live`     | Live transcript that survives suspension                | no                    | Needs S-04, S-05                                  |
| S-07       | `answer-the-agent`          | Answer a question or message a task                     | no                    | Needs S-05                                        |
| S-08       | `act-on-a-task`             | Cancel, finish, continue, draft PR, pin, archive        | no                    | Needs S-05                                        |
| S-09       | `read-the-diff`             | Read-only diff, file by file                            | no                    | Needs S-05                                        |
| S-10       | `notify-and-deep-link`      | Notify on a locked phone and deep-link to the task      | no                    | Needs F-01, S-05                                  |
| S-11       | `notifications-stay-honest` | No duplicate notifications; drop dead destinations      | no                    | Needs S-10                                        |
| S-12       | `settings-and-sign-out`     | Theme, versions, cockpit link, sign-out                 | no                    | Needs S-03, S-10                                  |

## Open Roadmap Questions

1. ~~**Can the perimeter return the operator to the installed app after authorizing?**~~
   **ANSWERED 2026-09-20 by building it.** The return destination *is* the path: the guard
   redirects to `https://$host$uri`, so an access link whose path is `/m/` returns to the
   app, and the product can build that link without ever holding a secret of its own — it
   re-paths the one the operator pastes. FR-005 stands as written and needs no perimeter
   change. **What is left is narrower and blocks nothing:** whether the `?key=` guard is
   reached at `/m/` (it depends on whether it sits in `server` or in `location /`, which is
   not visible from the client and not readable through the write-only deploy key). The app
   handles both and detects which it is in; the operator can settle it in one paste on the
   device. — Owner: operator. Block: nothing.
2. **Who owns the perimeter's configuration?** If Cezar's own installer generated it, a
   reinstall could overwrite what this product adds; if it is externally managed, it will
   not. — Owner: operator. Block: roadmap-wide — it decides whether F-01 must be
   re-applicable after a Cezar upgrade. *(PRD Open Question 2.)*
3. **Does an icon badge work in an installed web app on this phone?** Should be verified on
   the device before any work goes into it. — Owner: operator. Block: nothing; FR-042 is
   parked. *(PRD Open Question 4.)*
4. **Is 12 weeks still the right number?** The estimate predates the Socratic cuts and now
   carries slack. — Owner: operator. Block: nothing; it affects planning honesty, not
   scope. *(PRD Open Question 5.)*
5. **Two installed dependencies contradict the PRD.** `idb-keyval` was for the persisted
   offline snapshot and `virtua` for transcript virtualization; both were cut, and both are
   now listed under Non-Goals. They entered during scaffolding, from a rules file older
   than the cuts. — Owner: operator. Block: nothing, but they should go before a slice
   reaches for one out of habit.

## Parked

Nice-to-have in the PRD, deferred behind everything the PRD marks must-have — consistent with a
low-complexity goal and one operator working after hours. Any of these can be promoted:

- **Starting a new task from the phone** (FR-033, FR-034) — Why parked: the PRD demoted it
  on the argument that prompt quality drives agent output, and firing off a three-sentence
  task from a tram may cost more than it gives.
- **Icon badge** (FR-042) — Why parked: it restates what the notification already said, and
  needs a counter kept consistent while the app is closed. Open Roadmap Question 3 gates it.
- **Test notification** (FR-045) — Why parked: useful while building S-10, not a product
  requirement; fold it in there if it helps.
- **Cancelling a scheduled auto-resume** (FR-030) — Why parked: nice-to-have on a state the
  attention rule deliberately treats as "not needing a human".
- **Paging backwards through transcript history** (FR-049) — Why parked: the largest scope
  cut of the Socratic round; only the latest page is required.

Ruled out in the PRD's Non-Goals, recorded here so they cannot creep back: modifying Cezar
in any way; a second user or a second instance; Android; authoring workflows, skills,
settings or automations; project management; repository browsing; comparing task variants;
a command palette; syntax highlighting in the diff; background work of any kind other than
the notification; a persisted offline snapshot; camera attachments; a "Cezar is newer"
warning; app-store distribution; telemetry and third-party services.

## Done

(Empty. `/10x-archive` appends here when a change matching a Change ID is archived.)
