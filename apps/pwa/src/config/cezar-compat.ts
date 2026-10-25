/**
 * The Cezar version this client was built and tested against.
 *
 * Source: the latest release on 2026-10-25, which the host is being upgraded to (#125), and the
 * contract vendored for it (`packages/cezar-contract/UPSTREAM` = `69699d7` of
 * `open-mercato/cezar`, the npm package's `gitHead`, which tag `v0.16.3` matches). Confirm against the
 * live instance with `GET /api/v1/health` → `version`. Bump this together with
 * `npm run sync:contract <sha>` whenever the VPS moves (CLAUDE.md → "When
 * Cezar's API changes").
 */
export const TESTED_CEZAR_VERSION = '0.16.3'

/** Compares dotted version strings; missing segments count as 0. A source checkout reports
 *  `<release>-dev` (Cezar #1530), and `parseInt` reads `2-dev` as `2`, so it compares as the release. */
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
