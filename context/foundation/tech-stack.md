---
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
---

## Why this stack

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
