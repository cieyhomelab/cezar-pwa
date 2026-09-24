---
change_id: transcript-images
title: Show transcript images through the project-scoped images route
status: implemented
created: 2026-09-24
updated: 2026-09-24
archived_at: null
---

## Notes

Issue #65. Agents attach images to transcripts, but the phone showed only a file name for each.
The server records the URL in the unscoped form `/api/v1/runs/:id/images/:file`, and the live
host (Cezar `0.11.0`) answers it with 404. The project-scoped
`/api/v1/p/:projectId/runs/:id/images/:file` serves the bytes. There was no spec file; the issue
body is the spec.

## Decisions

- **Only the file name crosses over.** `attachmentFileName()` (`apps/pwa/src/domain/run-images.ts`)
  takes the last segment after `/images/`, strips `?`/`#`, and accepts only
  `^[A-Za-z0-9._-]+$` that is not all dots. The recorded path (including its run id) is never
  reused. `runImageUrl()` builds the scoped route from the screen's own project and run ids.
- **The reducer stores `file`** next to `name` on a `TranscriptImage`. A line without a safe
  file name keeps rendering as the old text line.
- **Fallback = the old line.** A missing `file`, or an `error` on the thumbnail or the
  full-screen image, shows `Image <name> — view it in the full cockpit`.
- **Full screen** is a portalled `role="dialog"` on solid black (the thumbnail can sit inside
  the sticky composer), closed by the Close button, a tap anywhere, or Escape.
- **Queued messages** use the same builder. Images and files share `images[]`, so only a name
  passing the contract's `isImageAttachmentName` gets a thumbnail. Other files are listed by name.
- **CSP unchanged:** `img-src 'self' data: blob:` already covers same-origin images, and the
  cookie rides along on a same-origin `<img>`.
- The service worker is unaffected: it never handles `/api/**` (rule 4).

## Evidence

`evidence/` — transcript thumbnail with the fallback line, full-screen view, and a queued
message's attachments at 390×844, light and dark (WebKit, `test/e2e/transcript-images.spec.ts`
with `E2E_EVIDENCE_DIR`).
