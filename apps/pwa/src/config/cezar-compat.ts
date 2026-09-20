/**
 * The Cezar version this client was built and tested against.
 *
 * Source: `docs/CEZAR_API.md` header — `open-mercato/cezar` @ main, packages
 * 0.11.1 (September 2026). Confirm against the live instance with
 * `GET /api/v1/health` → `version`, and bump this together with
 * `npm run sync:contract <sha>` whenever the VPS moves (CLAUDE.md → "Gdy API
 * Cezara się zmieni").
 */
export const TESTED_CEZAR_VERSION = '0.11.1'

/** Compares dotted version strings; missing segments count as 0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

/**
 * Whether the live instance runs ahead of what we tested (§4.7: show a warning,
 * do not block). A version we cannot parse is treated as "not newer".
 */
export function isCezarNewerThanTested(liveVersion: string | undefined | null): boolean {
  if (!liveVersion) return false
  return compareVersions(liveVersion, TESTED_CEZAR_VERSION) > 0
}
