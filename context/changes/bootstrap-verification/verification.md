---
bootstrapped_at: 2026-09-20T16:27:41Z
starter_id: vite-react
starter_name: Vite + React
project_name: cezar-pwa
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim from `context/foundation/tech-stack.md`:

```yaml
starter_id: vite-react
package_manager: npm
project_name: cezar-pwa
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: true
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: false
    can_judge_agent: true
  has_auth: false
  has_payments: false
  has_realtime: true
  has_ai: false
  has_background_jobs: true
```

### Why this stack

Solo operator, twelve after-hours weeks, building a phone client against a Cezar
instance that is itself the entire backend. Custom path was forced: the vetted
default for web+js is Astro+Supabase+Cloudflare, and all three pillars are ruled
out here, because Cezar rejects cross-origin writes with 403 and ships no CORS,
the PRD forbids third-party services, and there is no database to host once the
offline snapshot was cut. Filtering the JS pool by those avoids leaves
vite-react, vite-vue and angular. Only vite-react lets components and theme
tokens be lifted from Cezar's own cockpit, and virtua plus react-markdown are
React-only. It fails the convention-based gate, since stock Vite ships no
routing or layout opinions, so quality_override is true; CLAUDE.md already
closes that gap by pinning React Router 7, the api/domain/features split, and
fixed TanStack Query keys. has_auth is false because the product never
implements a login, it only detects a missing perimeter session. The push
sidecar behind has_background_jobs is a second component the frontmatter cannot
carry: build it from the hono card, which clears all four gates and self-hosts
beside Cezar. Deployment is self-host under nginx at /m/, the only target
same-origin permits.

## Pre-scaffold verification

| Signal      | Value                                     | Severity | Notes                                                            |
| ----------- | ----------------------------------------- | -------- | ---------------------------------------------------------------- |
| npm package | `create-vite` v9.2.1 published 2026-09-10 | fresh    | resolved from cmd_template; 10 days old at run time               |
| GitHub repo | not run                                   | n/a      | card `docs_url` is `https://vitejs.dev/guide/`, not a GitHub repo |

No stale signal. The `create-vite` 9.x line corresponds to the Vite 8 major that
`CLAUDE.md` pins for this project.

## Scaffold log

**Resolved invocation**: `npm create --yes vite@latest .bootstrap-scaffold -- --template react-ts`
**Strategy**: subdir-then-move
**Exit code**: 0
**Files moved**: 18 (11 top-level entries: 8 files, 3 directories)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (no `.gitignore` existed in cwd)
**.bootstrap-scaffold cleanup**: deleted (empty after move-up)

The `cmd_template` carries no `{pm}` placeholder, so the resolved package manager
(`npm`) was recorded but unused for substitution.

Files landed at the repository root:

```
.gitignore           index.html            tsconfig.json
.oxlintrc.json       package.json          tsconfig.app.json
README.md            vite.config.ts        tsconfig.node.json
public/favicon.svg   public/icons.svg
src/App.css          src/App.tsx           src/index.css        src/main.tsx
src/assets/hero.png  src/assets/react.svg  src/assets/vite.svg
```

Pre-existing `CLAUDE.md`, `context/`, `docs/` and `.git/` were untouched. No path
under `context/` appeared in the scaffold, so the preserve rule was not exercised.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW (0 INFO, 0 total)
**Direct vs transitive**: not distinguished by this tool — the npm version in use
reports `metadata.dependencies` as prod/dev/optional/peer rather than a `direct`
count. Resolved tree: 70 dependencies (4 prod, 67 dev, 46 optional).

**Deviation from the default flow**: the first `npm audit --json` invocation failed
with `ENOLOCK` — `create-vite` scaffolds without installing, so no lockfile existed
and the audit had nothing to read. Rather than log the slot as unavailable, the
operator was asked and chose to generate a lockfile only. `npm i --package-lock-only`
was run (exit 0, 71 packages audited, no `node_modules` written), then the audit was
re-run successfully. `package-lock.json` is therefore a bootstrapper-written artifact
in this run, not a create-vite output. Dependencies are still NOT installed.

No CRITICAL, HIGH, MODERATE or LOW findings. Clean tree.

## Hints recorded but not acted on

| Hint                    | Value                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| bootstrapper_confidence | verified                                                                                                  |
| quality_override        | true — vite-react failed the convention-based gate; v1 applies no compensation                            |
| path_taken              | custom                                                                                                    |
| self_check_answers      | typed: true, from_official_starter: true, conventions: true, docs_current: false, can_judge_agent: true   |
| team_size               | solo                                                                                                      |
| deployment_target       | self-host                                                                                                 |
| ci_provider             | github-actions — no CI files generated in v1                                                              |
| ci_default_flow         | auto-deploy-on-merge — no CI files generated in v1                                                        |
| has_auth                | false                                                                                                     |
| has_payments            | false                                                                                                     |
| has_realtime            | true — no scaffold change; the SSE client is hand-written work                                            |
| has_ai                  | false                                                                                                     |
| has_background_jobs     | true — the Hono push sidecar was NOT scaffolded; see Next steps                                           |

## Known gap: repository layout

The hand-off carries one `starter_id` and no layout field, so this run produced a
single-package Vite app at the repository root. `CLAUDE.md` mandates an npm-workspaces
monorepo (`apps/pwa/`, `apps/push-sidecar/`, `packages/shared/`, `packages/cezar-contract/`,
`deploy/`, `scripts/`). Reconciling the two is manual work bootstrapper v1 cannot do.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your
project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- Move the scaffolded app into `apps/pwa/` and hand-write the workspace root
  `package.json` with a `workspaces` array, per the structure in `CLAUDE.md`.
- Scaffold the push sidecar separately into `apps/push-sidecar/` from the `hono` card
  (`npm create hono@latest`), which the hand-off names but could not carry in frontmatter.
- Add `.env.local` to `.gitignore` before any Cezar cookie is stored there — `CLAUDE.md`
  rule 6 forbids secrets in the repo.
- `git init` is not needed; this repository already has history.
- No `.scaffold` siblings were created, so there is nothing to diff and reconcile.
- Audit findings: none. Re-run `npm audit` after the workspace restructure, since the
  dependency tree will change.
