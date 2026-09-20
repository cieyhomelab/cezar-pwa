# @cezar-pwa/cezar-contract

Vendored copy of Cezar's request/response schemas and agent event dictionary:

| Vendored file | Source in `open-mercato/cezar` |
| --- | --- |
| `src/contract/**` | `packages/contract/src/**` |
| `src/protocol/ui-events.ts` | `packages/api-client/src/protocol/ui-events.ts` |

**`src/` is empty until you sync it.** The directory is created by:

```bash
npm run sync:contract <sha>
```

## Why this is vendored rather than installed

`@open-mercato/cezar-contract` and `cezar-api-client` exist on npm only as
prereleases (`0.10.0-pr931…`, September 2026) that are *older* than the server
we run (0.11.x). The published packages therefore do not describe the live API.
Pinning a commit is the only way to match what is actually deployed on the VPS.

## Rules

- **Never edit these files by hand** (CLAUDE.md rule 3). Re-run the sync instead.
- Missing something the upstream contract does not cover? Add a local type in
  `apps/pwa/src/api/types.local.ts` with a comment naming where it came from.
- Pick the sha that matches the instance: `GET /api/v1/health` → `version`, then
  the commit for that release. After syncing, bump `TESTED_CEZAR_VERSION` in
  `apps/pwa/src/config/cezar-compat.ts` and run `npm test`.
