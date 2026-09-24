# badge-check

- **Issue:** #68 — does an icon badge work in the installed PWA? (FR-042, PRD Open Question 4)
- **Status:** check shipped; answer pending on the operator's iPhone.
- **Kind:** temporary diagnostic, not a feature. Remove once the answer is in roadmap Open
  Question 3, or grow it into FR-042.

What ships: Settings → "Icon badge check" in the installed app (set 3 / clear), and the test
notification setting the badge to 1 from the service worker. Evidence: `evidence/` (WebKit,
390×844, stubbed badge API — the real badge is the device's to show).
