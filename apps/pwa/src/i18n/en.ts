import type { ApiErrorCode } from '../api/http.ts'

/**
 * Every user-facing string lives here (CLAUDE.md: UI text in English, only through
 * `src/i18n/en.ts`). The app is single-locale: the shape would take a sibling module,
 * but nothing selects a locale and nothing is meant to.
 */

/** Said in two places: a `not-routed` answer and every other way the sidecar goes quiet. */
const PUSH_UNAVAILABLE = 'The notification server is not responding. Try again later.'

/** English plural: 1 → one, everything else → other. */
function plural(count: number, one: string, other: string): string {
  return count === 1 ? one : other
}

export const en = {
  app: {
    name: 'Cezar',
    tagline: 'Agent overview',
  },
  /**
   * What this app judged about an answer, keyed by `ApiError.code` (`api/http.ts`). Never the
   * server's own reason — that one is shown verbatim (FR-032) and needs no translation.
   */
  apiError: {
    'unexpected-shape': 'Cezar answered in an unknown format',
    'invalid-json': "Cezar's answer is not valid JSON",
    'not-routed': PUSH_UNAVAILABLE,
    /** A bare status is not a reason: the screen's own "could not load…" already said that much. */
    'no-detail': '',
  } satisfies Record<ApiErrorCode, string>,
  /** Compact age, one unit, as `shortAge` (`domain/run-display.ts`) measures it. */
  age: {
    seconds: (count: number) => `${count} s`,
    minutes: (count: number) => `${count} min`,
    hours: (count: number) => `${count} h`,
    days: (count: number) => (count === 1 ? '1 day' : `${count} days`),
  },
  shell: {
    openCockpit: 'Open in the full cockpit',
    /** S-12, FR-048: the task's own screen, in the cockpit. Short: it sits in the top bar. */
    openTaskInCockpit: 'In cockpit',
    openTaskInCockpitLabel: 'Open this task in the full cockpit',
  },
  auth: {
    /** The first probe, before anything is known. */
    checking: 'Checking the connection to Cezar…',
    title: 'Connect to Cezar',
    /** Says plainly that this is not a login — there is no account to log into. */
    intro:
      'This app has no login of its own. Access is granted by the gateway in front of Cezar, and the installed app keeps its own cookies — which is why it has to be unlocked separately.',
    linkLabel: 'Paste the access link',
    /** Built from the page's own origin, so every instance shows its own host. */
    linkPlaceholder: (origin: string) => `${origin}/…?key=…`,
    submit: 'Connect',
    /** Reassurance that pasting a secret here is safe. R-AUTH-5. */
    privacy: 'The link is not stored anywhere — it only serves to pass the gateway.',
    /**
     * The key came back unconsumed: either the link is wrong or incomplete, or
     * the server has no unlock at /m/. Both are said, because the app cannot
     * tell them apart.
     */
    unlockFailed: 'The gateway did not accept this link. Check that the whole link was copied — including the key at the end.',
    unlockFailedServer:
      'If the link is complete, the server does not yet handle unlocking at the app address — run deploy/nginx/install.sh on the server.',
    /**
     * Only true in a browser tab. The installed app keeps its own cookies
     * (R-AUTH-1), so a session opened in Safari never reaches it — offering
     * this there would send the operator down a path that cannot work.
     */
    manualTab: 'You can also open the link in this browser and come back here.',
    recheck: 'Check again',
    rechecking: 'Checking…',
    errors: {
      empty: 'Paste the access link.',
      notAUrl: 'That does not look like an address. Copy the whole link, including “https://”.',
      foreignOrigin: 'This link points somewhere other than this app.',
      missingKey: 'The link has no “key” parameter. Copy the whole link from the message.',
    },
    unreachable: {
      title: 'Cannot reach Cezar',
      body: 'The server is not answering. That does not mean access expired — check the network and try again.',
    },
  },
  runs: {
    /** US-02: the answer to "does anything need me?", before any row is read. */
    summary: {
      none: 'Nothing is waiting for you',
      /** Under a project filter, attention elsewhere is still said — never hidden. */
      elsewhere: (count: number) => `${count} in other projects`,
      some: (count: number) => `${count} ${plural(count, 'task needs', 'tasks need')} attention`,
    },
    loading: 'Loading tasks…',
    sections: {
      attention: 'Needs attention',
      running: 'In progress',
      queued: 'Queued',
      finished: 'Finished',
    },
    filter: {
      label: 'Project',
      all: 'All projects',
    },
    empty: {
      all: 'No tasks. New tasks will show up here.',
      project: 'This project has no tasks.',
    },
    /** A status is never conveyed by colour alone — every dot carries one of these. */
    status: {
      'needs permission': 'asking for permission',
      'needs you': 'waiting for you',
      'needs review': 'to review',
      failed: 'failed',
      scheduled: 'scheduled',
      monitoring: 'monitoring',
      running: 'working',
      queued: 'queued',
      done: 'done',
      cancelled: 'cancelled',
    } as Record<string, string>,
    timing: {
      queued: (position: number) => `#${position} in queue`,
      scheduled: (at: string) => `resumes at ${at}`,
      since: (age: string) => `for ${age}`,
      ago: (age: string) => `${age} ago`,
    },
    unread: 'unread',
    reference: {
      PR: (n: number) => `PR #${n}`,
      Issue: (n: number) => `#${n}`,
    },
    showOlder: (count: number) => `Show older (${count})`,
    /** FR-012: the live connection's state, always in words. */
    live: {
      live: 'Live',
      connecting: 'Connecting…',
      reconnecting: 'Reconnecting…',
      lost: 'No live connection',
    } as Record<string, string>,
    /** When not live: how old the list on screen is. */
    listFrom: (time: string) => `list from ${time}`,
    refreshingInline: 'refreshing…',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    pull: 'Pull to refresh',
    release: 'Release to refresh',
    /** Guardrail: a stale status is never presented as current. */
    refreshFailed: (time: string) => `Could not refresh. This list is from ${time}.`,
    loadFailed: 'Could not load the tasks.',
    retry: 'Try again',
    truncated: (limit: number, projects: string) =>
      `Showing only the ${limit} newest tasks from: ${projects}. Older ones are in the full cockpit.`,
    newTask: 'New task',
    /** #67: clear the unread markers of the tasks on screen, one call per project in view. */
    readAll: {
      action: (count: number) => `Mark all read (${count})`,
      confirmTitle: (count: number) => (count === 1 ? 'Mark 1 task read?' : `Mark ${count} tasks read?`),
      confirmBody: (projects: string) =>
        `Every unread task in ${projects} loses its marker, including older ones not listed here. You can mark a task unread again one at a time, in the cockpit.`,
      back: 'Back',
      confirm: 'Mark read',
      working: 'Marking read…',
      done: (count: number) => (count === 1 ? 'Marked 1 task read.' : `Marked ${count} tasks read.`),
      failed: (project: string, reason: string) => `${project} was not marked read. ${reason}`,
    },
  },
  /** S-13: start a task from the phone (FR-033), then land on it (FR-034). */
  newTask: {
    back: 'Tasks',
    title: 'New task',
    project: 'Project',
    task: 'Task',
    taskPlaceholder: 'Describe the work…',
    workflow: 'Workflow',
    runner: 'Agent',
    model: 'Model',
    /** No model named: the runner picks its own. */
    modelAuto: 'Auto',
    /** `modelsLocked`: the agent's own settings choose, and the cockpit makes the pick read-only. */
    modelLocked: "Set by the agent's own settings",
    account: 'Account',
    accountDefault: "Project's account",
    autonomous: 'Autonomous',
    autonomousHint: 'Never stops to wait for you; continues until done.',
    noRunners: 'No agent is installed on the server, so no task can start.',
    loading: 'Loading options…',
    loadFailed: 'Could not load the options for this project.',
    retry: 'Try again',
    submit: 'Start task',
    submitting: 'Starting…',
    failed: {
      /** The server's own words, verbatim (FR-032). */
      refused: (reason: string) => `Cezar refused: ${reason}`,
      network: 'No connection to Cezar — nothing was sent.',
      /** A create that timed out may still have started one; a blind retry would start two. */
      timeout: 'Cezar did not answer in time. The task may have started — check the list before trying again.',
      auth: 'The session with Cezar expired — connect again.',
      /** A 2xx without a run id: something started, but there is nothing to open. */
      noRun: 'Cezar accepted the task but did not say which one it is. It will appear in the list.',
    },
  },
  /** S-05: one task — its header, its plan and the newest stretch of its transcript. */
  run: {
    back: 'Tasks',
    loading: 'Loading task…',
    loadFailed: 'Could not load the task.',
    notFound: 'No such task. It may have been deleted.',
    retry: 'Try again',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    updatedAt: (time: string) => `Updated ${time}`,
    /** S-06, when the task's stream is not live: how old the screen is. */
    stateFrom: (time: string) => `state from ${time}`,
    /** FR-019: scrolled up while the agent wrote more. */
    newMessages: 'New messages',
    /** Guardrail: a stale status is never presented as current. */
    refreshFailed: (time: string) => `Could not refresh. State from ${time}.`,
    header: {
      workflow: 'Workflow',
      step: (position: number, total: number, name: string) =>
        `Step ${position}/${total}${name ? ` · ${name}` : ''}`,
      agent: 'Agent',
      cost: 'Cost',
      tokens: 'Tokens',
      tokensDirectional: (input: string, output: string) => `in ${input} · out ${output}`,
      branch: 'Branch',
      pr: (number: string | null) => (number ? `PR #${number}` : 'Pull request'),
      /** S-09: the row that opens the diff. */
      changes: 'Changes',
      showChanges: 'Show changes',
    },
    /** S-09: the task's diff, file by file, read-only (FR-031). */
    diff: {
      back: 'Task',
      title: 'Changes',
      loading: 'Loading changes…',
      loadFailed: 'Could not load the changes.',
      /** A 409: the server's own reason follows, e.g. the task ran without a worktree. */
      refused: 'No changes to show.',
      empty: 'No changes — the worktree matches the base branch.',
      emptyActive: 'The agent has not changed anything yet. Changes will show up here as it works.',
      files: (count: number) => `${count} ${plural(count, 'file', 'files')}`,
      countsLabel: (adds: number, dels: number) =>
        `${adds} ${plural(adds, 'line added', 'lines added')}, ${dels} removed`,
      repointed: (head: string, task: string) =>
        `The worktree is on branch ${head}, not on the task branch ${task} — only what the task changed there is visible.`,
      status: {
        added: 'added',
        modified: 'modified',
        deleted: 'deleted',
        renamed: 'renamed',
        copied: 'copied',
      } as Record<string, string>,
      /** A status the vocabulary grew after `v0.11.0` (rule 5). */
      statusUnknown: 'modified',
      renamedFrom: (path: string) => `from ${path}`,
      binary: 'Binary file — no text preview.',
      image: 'Image — preview only in the cockpit.',
      noContent: 'No change in content (a rename or a mode change).',
      truncated: 'The server clipped this patch — the whole of it is in the cockpit.',
      openCockpit: 'Open cockpit',
      showMore: (count: number) => `Show ${count} more ${plural(count, 'line', 'lines')}`,
      /** Screen-reader words for the one-character markers. */
      lineKind: { add: 'added', del: 'removed', context: '' } as Record<string, string>,
    },
    plan: {
      title: 'Plan',
      progress: (done: number, total: number) => `${done}/${total}`,
      /** Glyph + word, never colour alone. */
      status: {
        completed: 'done',
        in_progress: 'in progress',
        pending: 'to do',
        cancelled: 'not needed',
      } as Record<string, string>,
    },
    transcript: {
      heading: 'Transcript',
      /** FR-049 is parked: only the newest page is shown. */
      older: 'Older entries are available in the full cockpit.',
      empty: 'The transcript is still empty.',
      loadFailed: 'Could not load the transcript.',
      task: 'Task',
      you: 'You',
      imagesAttached: (count: number) =>
        `${count} ${plural(count, 'attachment', 'attachments')}`,
      reasoning: 'Reasoning',
      tool: {
        input: 'Input',
        output: 'Output',
        error: 'Error',
        exitCode: (code: number) => `exit code ${code}`,
        clipped: (count: number) => `… ${count} characters skipped from the start`,
        children: (count: number) =>
          `${count} ${plural(count, 'subagent step', 'subagent steps')}`,
        /** Status glyph + word per `ToolStatus`; unknown statuses show their raw name. */
        status: {
          pending: 'pending',
          running: 'in progress',
          completed: 'done',
          failed: 'failed',
          declined: 'declined',
        } as Record<string, string>,
      },
      /** The line an image falls back to when it has no safe file name or fails to load (#65). */
      image: (name?: string) => `Image${name ? ` ${name}` : ''} — view it in the full cockpit`,
      images: {
        alt: 'Image',
        open: (name?: string) => `Open image${name ? ` ${name}` : ''} full screen`,
        close: 'Close',
      },
      /** A markdown image is never loaded (`Markdown.tsx`); this stands in for a missing alt. */
      markdownImageAlt: 'image',
      providerAuth: (provider: string) =>
        `The ${provider} agent lost its login. Sign it in again in the full cockpit.`,
      ask: {
        title: 'Agent question',
        answered: (answer: string) => `Answer: ${answer}`,
        pending: 'Waiting for an answer',
        /** The reducer resolves only the newest question, so an older open one is dead. */
        superseded: 'The agent has since asked a new question — answer that one below.',
        multiSelect: 'select all that apply',
        pickOrWrite: 'Pick an answer or write your own in the field below.',
        answerEach: 'Answer every question, or write your own answer in the field below.',
        send: 'Send answer',
        sendAndReopen: 'Send and resume the session',
        /** Said before the tap: answering a closed session does more than reply. */
        resumeHint: 'The session has ended — an answer will reopen it and reach the agent.',
        sent: 'Answer sent. Waiting for it to show up in the transcript.',
      },
      footer: {
        waiting: 'The agent is waiting for your answer.',
        failed: 'The session ended with an error.',
        failedWith: (error: string) => `The session ended with an error — ${error}`,
        review: 'Session closed — waiting for your review.',
        closed: 'Session closed.',
      },
    },
    /** S-07: the composer, and why a send did not go through (FR-032). */
    compose: {
      label: 'Message to the agent',
      placeholder: {
        running: 'Write to the agent…',
        waiting: 'Answer the agent…',
        queued: 'Add to the prompt…',
        resume: 'Your own answer — resumes the session…',
      },
      hint: {
        queued: 'The task has not started yet. What you add goes into the prompt.',
        resume: 'The session has ended. Sending an answer will reopen it.',
      },
      send: 'Send',
      sending: 'Sending…',
      queuedTitle: (count: number) =>
        `${count} ${plural(count, 'message added', 'messages added')} to the prompt`,
      /** #66: editing or removing a stacked message before the task starts. */
      queue: {
        /** A stacked message's attachment that is not shown as an image (#65). */
        attachment: (name?: string) => `Attachment${name ? ` ${name}` : ''}`,
        edit: 'Edit',
        editLabel: 'Edit the queued message',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        remove: 'Remove',
        removing: 'Removing…',
        confirmRemove: 'Remove this message from the prompt?',
        keep: 'Keep',
        /** A 404 or 409: the task started and took the message with it. Not a failure. */
        alreadySent: 'Already sent — the task has started with this message.',
      },
      deferred: 'The session is starting — the message will reach the agent as soon as it opens.',
      failed: {
        /** The server's own words, verbatim (FR-032). */
        refused: (reason: string) => `Cezar refused: ${reason}`,
        network: 'No connection to Cezar — nothing was sent.',
        /** A write that timed out may still have landed; a blind retry could send it twice. */
        timeout: 'Cezar did not answer in time. The message may have arrived — refresh before sending it again.',
        auth: 'The session with Cezar expired — connect again.',
        unavailable:
          'The session has ended and Cezar did not record its id, so this answer cannot be delivered.',
      },
    },
    /** S-08: the task's own actions (FR-025 to FR-029), and why one did not go through (FR-032). */
    actions: {
      label: 'Task actions',
      archivedBadge: 'Archived',
      pinnedBadge: 'Pinned',
      cancel: 'Cancel',
      cancelling: 'Cancelling…',
      /** `waiting` closes the session, `review` accepts the changes: one endpoint, two meanings. */
      finish: { waiting: 'Finish', review: 'Accept' } as Record<string, string>,
      finishing: 'Finishing…',
      draftPr: 'Open draft PR',
      draftPrPending: 'Opening PR…',
      continue: 'Continue',
      continuing: 'Resuming…',
      pin: 'Pin',
      unpin: 'Unpin',
      pinning: 'Saving…',
      archive: 'Archive',
      unarchive: 'Restore from archive',
      archiving: 'Saving…',
      confirmCancel: {
        title: 'Cancel this task?',
        body: 'The agent will be stopped and the task will end as cancelled. The worktree stays.',
        keep: 'Keep it',
        confirm: 'Cancel the task',
      },
      done: {
        cancel: 'Task cancelled.',
        alreadySettled: 'The task had already finished — there was nothing to cancel.',
        accepted: 'Changes accepted, task finished.',
        finished: 'Session closed.',
        draftPr: 'Draft PR opened — the link is in the header.',
        draftPrDryRun: "Cezar's dry-run mode: the PR was not really opened.",
        continued: 'Session resumed.',
        archived: 'Task archived — it is gone from the list.',
      },
      failed: {
        /** The server's own words, verbatim (FR-032). */
        refused: (reason: string) => `Cezar refused: ${reason}`,
        network: 'No connection to Cezar — nothing changed.',
        /** A write that timed out may still have happened; a blind retry could do it twice. */
        timeout: 'Cezar did not answer in time. The action may have gone through — refresh before trying again.',
        auth: 'The session with Cezar expired — connect again.',
      },
    },
    /** S-21 (#71): the task's sibling variants and keeping this one. Comparing diffs stays in the cockpit. */
    variants: {
      label: 'Variants',
      loading: 'Loading variants…',
      loadFailed: 'Could not load the variants.',
      retry: 'Try again',
      variant: (letter: string) => `Variant ${letter}`,
      thisOne: 'this task',
      archived: 'archived',
      /** The worktree is gone (or unreadable), so the change count is unknown — not zero. */
      changesUnknown: 'changes unknown',
      changes: (count: number) => `${count} ${plural(count, 'file changed', 'files changed')}`,
      keep: 'Keep this one',
      keeping: 'Keeping…',
      /** The server answers `409` until the kept variant has settled. */
      waitToKeep: 'This variant can be kept once it has finished.',
      confirm: {
        title: (letter: string) => `Keep variant ${letter}?`,
        body: (others: number) =>
          `The other ${others === 1 ? 'variant' : `${others} variants`} will be stopped if still running, archived, and ${others === 1 ? 'its worktree and branch' : 'their worktrees and branches'} deleted. This cannot be undone.`,
        back: 'Not yet',
        confirm: (letter: string) => `Keep variant ${letter}`,
      },
      kept: (letter: string) => `Kept variant ${letter} — the others were archived.`,
    },
    /** S-19 (#69): the task's pull request — its checks, whether it can merge, and the merge. */
    merge: {
      label: (number: number) => `Pull request #${number}`,
      loading: 'Loading the merge state…',
      loadFailed: 'Could not load the merge state.',
      retry: 'Try again',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      /** `available: false` — the server's own reason follows, verbatim. */
      unavailable: 'The merge state is unavailable:',
      unreadable: 'Cezar answered about this pull request in a form this app cannot read.',
      /** The project's repository has a PR with this number, but it is not the one the task links to. */
      otherPr: 'This pull request is not in the project’s repository, so it can only be merged on GitHub.',
      headline: {
        merged: 'Merged',
        closed: 'Closed without merging',
        draft: 'Draft — mark it ready on GitHub before merging',
        conflicts: 'Has conflicts',
        ready: 'Ready to merge',
        failing: 'Checks failing',
        pending: 'Checks pending',
        blocked: 'Merge blocked',
        unknown: 'Merge requirements unconfirmed',
      },
      /** Spelled out, so a check's state never rests on its colour alone. */
      checkState: {
        failing: 'failing',
        pending: 'pending',
        unknown: 'unknown',
        passing: 'passing',
      },
      required: 'required',
      checksSummary: (passing: number, total: number) => `${passing} of ${total} ${plural(total, 'check', 'checks')} passing`,
      noChecks: 'No checks reported.',
      details: 'details',
      method: {
        squash: 'Squash and merge',
        merge: 'Create a merge commit',
        rebase: 'Rebase and merge',
      },
      methodLabel: 'Merge method',
      override: 'Merge without waiting for requirements',
      overrideHint: 'GitHub allows this only if your permissions can bypass the repository’s rules.',
      mergeButton: 'Merge…',
      confirm: {
        title: (number: number) => `Merge pull request #${number}?`,
        body: (title: string, base: string) => `“${title}” will be merged into ${base}.`,
        /** The server re-reads the PR and refuses a head that moved since this screen read it. */
        head: (sha: string) => `Only commit ${sha} is merged: if anything was pushed since, Cezar refuses.`,
        /** A poll brought a newer head while the confirmation was open: it has not been seen. */
        moved: (sha: string) => `New commits were pushed (now ${sha}). Go back and check them before merging.`,
        override: 'You are asking GitHub to bypass unmet requirements. It may refuse.',
        back: 'Not yet',
      },
      merging: 'Merging…',
      merged: (number: number) => `Pull request #${number} merged.`,
      failed: {
        /** A merge that timed out may still have happened: the state is re-read instead of a retry. */
        timeout: 'Cezar did not answer in time. The merge may have happened — the state below was re-read.',
      },
    },
  },
  /** S-20 (#70): react to a project's automations. Creating and editing them stays in the cockpit (N05). */
  automations: {
    title: 'Automations',
    /** The list screen's link to this one. */
    open: 'Automations',
    back: 'Tasks',
    project: 'Project',
    loading: 'Loading automations…',
    loadFailed: 'Could not load the automations.',
    retry: 'Try again',
    /** `capabilities.automations` is off: every route of the family would answer 409. */
    off: 'Automations are turned off on this Cezar.',
    /** `available: false` — the server's own reason follows, verbatim. */
    unavailable: 'GitHub automations are unavailable:',
    empty: 'This project has no automations. They are created in the full cockpit.',
    enabled: 'Enabled',
    paused: 'Paused',
    lastRun: (when: string) => `Last run ${when}`,
    neverRun: 'Never run',
    nextRun: (when: string) => `Next ${when}`,
    openLastRun: 'Open the last task',
    pause: 'Pause',
    pausing: 'Pausing…',
    enable: 'Enable',
    enabling: 'Enabling…',
    runNow: 'Run now',
    running: 'Starting…',
    confirmRun: {
      title: (name: string) => `Run “${name}” now?`,
      body: 'This starts a new task right away, whether the automation is paused or not. Its schedule stays as it is.',
      back: 'Not now',
      confirm: 'Run now',
    },
    done: {
      paused: (name: string) => `“${name}” paused.`,
      enabled: (name: string) => `“${name}” enabled.`,
      started: (name: string) => `“${name}” started a task.`,
      openTask: 'Open the task',
    },
    trigger: {
      daily: (at: string) => `Every day at ${at}`,
      weekdays: (at: string) => `Weekdays at ${at}`,
      weekly: (day: string, at: string) => `${day}s at ${at}`,
      hours: (every: number) => (every === 1 ? 'Every hour' : `Every ${every} hours`),
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      github: (events: string) => `GitHub: ${events}`,
      githubNoEvents: 'GitHub activity',
      unknown: 'Unknown trigger',
    },
    events: {
      'pull_request.opened': 'new pull request',
      'issue.opened': 'new issue',
      'issue.labeled': 'issue labelled',
      'issue.unlabeled': 'issue unlabelled',
      'pull_request.reviewed': 'review submitted',
      'pull_request.review_requested': 'review requested',
      'pull_request.rereview_requested': 'review re-requested',
    },
    log: {
      title: 'Recent activity',
      loading: 'Loading the log…',
      loadFailed: 'Could not load the log.',
      empty: 'Nothing has happened yet.',
      showAll: (count: number) => `Show ${count} more`,
      unknownAutomation: 'Removed automation',
    },
    results: {
      launched: 'Started a task',
      'no-match': 'No match',
      duplicate: 'Already handled',
      'rate-limited': 'GitHub rate limit',
      error: 'Error',
      baseline: 'Baseline set',
      preview: 'Preview',
      manual: 'Run by hand',
      'catch-up': 'Caught up a missed run',
      skipped: 'Skipped',
      failed: 'Launch failed',
    },
  },
  settings: {
    title: 'Settings',
    /** The footer link that opens the screen. */
    open: 'Settings',
    back: 'Task list',
    /** S-12, FR-046. */
    theme: {
      section: 'Theme',
      options: { system: 'System', dark: 'Dark', light: 'Light' } as Record<string, string>,
    },
    /** S-12, FR-047. Both versions, and nothing more: the "Cezar is newer" warning is a non-goal. */
    versions: {
      section: 'Versions',
      app: 'App',
      /** The build's commit and when it was built. */
      appValue: (commit: string, builtAt: string | undefined) =>
        builtAt ? `${commit} · built ${builtAt}` : commit,
      cezar: 'Cezar',
      cezarUnknown: 'unknown — no connection',
      tested: 'Tested with Cezar',
    },
    /** S-12, FR-006. */
    signOut: {
      section: 'Sign out',
      intro:
        'Removes everything the app keeps on this phone, turns notifications off on this device and ends the session. To come back you will need the access link.',
      action: 'Sign out',
      confirmTitle: 'Sign out of Cezar?',
      confirmBody: 'After signing out the app will ask for the access link.',
      confirm: 'Sign out',
      keep: 'Cancel',
      working: 'Signing out…',
      /** The perimeter did not confirm: local data and notifications are done, the cookie is not. */
      sessionKept:
        'The data on this phone is gone, but the server did not confirm the session ended — the app still has access to Cezar. Try again once you have a network.',
      notificationsKept:
        'Could not turn notifications off on this device. Turn them off in iOS Settings → Notifications → Cezar.',
      retry: 'Try again',
    },
  },
  /** S-10: notifications — the settings section and the notification text itself. */
  push: {
    section: 'Notifications',
    /** FR-038, FR-043: what a notification says, and what it never carries. */
    intro:
      'A notification arrives when a task is waiting for your answer, waiting for review, or has ended with an error. It carries the task title, the project and the reason — no code and nothing from the conversation.',
    /** FR-037: in a browser tab the permission prompt cannot work on iOS. */
    installTitle: 'First add Cezar to your home screen',
    installBody:
      'On an iPhone, notifications only work in the app opened from its icon. In Safari tap “Share”, then “Add to Home Screen”, and open Cezar from the home screen.',
    unsupported: 'This device does not support notifications (iOS 16.4 or newer is needed).',
    denied: 'Notifications are blocked. Turn them on in iOS Settings → Notifications → Cezar.',
    checking: 'Checking notifications…',
    off: 'Notifications are off.',
    on: 'Notifications are on for this device.',
    enable: 'Turn on notifications',
    enabling: 'Turning on…',
    disable: 'Turn off notifications',
    disabling: 'Turning off…',
    test: 'Send a test notification',
    testing: 'Sending…',
    testSent: 'Sent — the notification should show up in a moment.',
    errors: {
      dismissed: 'Notification permission was not granted.',
      unknownDevice: 'The server does not know this device — turn notifications off and on again.',
      gone: 'The push service no longer knows this device — turn notifications on again.',
      unavailable: PUSH_UNAVAILABLE,
      /** The sidecar answered, but not in its own shape — `ApiError.code` said so. */
      unexpectedShape: 'The notification server answered in an unknown format',
      auth: 'The session with Cezar expired — connect again.',
      failed: (reason: string) => `Failed: ${reason}`,
    },
    /** The notification body says why, keyed by the attention label (`deriveAttention().label`). */
    reason: {
      'needs you': 'Waiting for your answer',
      'needs review': 'Waiting for review',
      failed: 'Ended with an error',
      'needs permission': 'Asking for permission',
    } as Record<string, string>,
    fallbackTitle: 'Cezar',
    fallbackReason: 'Needs attention',
    testTitle: 'Cezar',
    testBody: 'Notifications are working.',
  },
  install: {
    title: 'Add Cezar to your home screen',
    /** iOS has no install prompt — the operator does it from the Share sheet. */
    ios: 'Tap “Share”, then “Add to Home Screen”.',
    dismiss: 'Not now',
  },
  update: {
    available: 'A new version of the app',
    action: 'Refresh',
    dismiss: 'Later',
  },
  offline: {
    banner: 'No connection — the data may be out of date',
  },
} as const

export type Messages = typeof en
