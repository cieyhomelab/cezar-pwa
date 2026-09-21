---
change_id: connect-to-cezar
title: Detect a missing session and offer re-unlocking from inside the app
status: implemented
created: 2026-09-20
updated: 2026-09-21
archived_at: null
---

## Notes

Roadmap slice **S-02** (`context/foundation/roadmap.md`), PRD refs FR-004, FR-005.

Opened by an implementation run, like `install-to-home-screen` before it: no spec existed
for S-02, so `plan.md` is **derived** from the roadmap slice, the two PRD requirements it
names, and the measured gateway mechanics in `docs/CEZAR_API.md` § 1a.

## The blocker, and why it did not stop the work

The roadmap marked S-02 **blocked** on Open Roadmap Question 1: *does the perimeter admit a
return path, or does FR-005 reduce to "the operator re-opens the icon by hand"?*

Reading the recorded guard — `if ($arg_key = "…") { add_header Set-Cookie …;
return 302 https://$host$uri; }` — answers it: the return destination is the link's **path**,
and the product can supply a path without ever holding a secret, because it re-paths the
link the operator pastes. So FR-005 stands as written, with no perimeter change.

What is genuinely unknown is narrower: whether that guard is *reached* at `/m/` at all. It
depends on whether it sits in the `server` block or inside `location /`, which is invisible
from a client and unreadable from here (the deploy key is `command="/usr/bin/rrsync -wo
/var/www"` — no shell, no `/etc/nginx`). Rather than wait, the slice ships the behaviour
that is correct in both worlds and **detects which one it is in at runtime**: if the key
comes back unconsumed, it is stripped from the history entry and the operator is told to
open the link in Safari and return — which the visibility re-probe then completes with
nothing pressed.

One paste on the real device settles it. Until then nothing is blocked, and no work is
wasted either way.

## Evidence

`evidence/` holds WebKit captures at 390×844 in both themes: the connect screen, the
validation refusal, the unconsumed-key fallback, the unreachable state, and the authorized
shell behind the gate.
