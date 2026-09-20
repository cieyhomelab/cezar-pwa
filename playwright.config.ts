import { defineConfig, devices } from '@playwright/test'

// Mobile Safari is the primary target (CLAUDE.md), so the only project is
// WebKit at iPhone dimensions. WebKit is not installed by default — run
// `npx playwright install webkit` once before the first E2E run.
// `reuseExistingServer` cannot tell this branch's preview from one another
// worktree left running on the same port — and reusing the wrong one tests the
// wrong build while reporting green. Set `E2E_PORT` to get an isolated server.
const port = Number(process.env.E2E_PORT ?? 4173)
const origin = `http://localhost:${port}`

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // On CI, annotate the PR inline AND leave an HTML report behind for the
  // failure artifact (it embeds the retry traces).
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    // The PWA is always served under /m/ (nginx alias in production, Vite base
    // in dev), so every relative navigation has to resolve inside that scope.
    baseURL: `${origin}/m/`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'webkit-iphone',
      use: { ...devices['iPhone 14'], defaultBrowserType: 'webkit' },
    },
  ],
  webServer: {
    // E2E runs against the built artifact, not the dev server: the manifest link
    // and the service worker only exist in a production build.
    command: `npm run build -w @cezar-pwa/pwa && npm run preview -w @cezar-pwa/pwa -- --port ${port} --strictPort`,
    url: `${origin}/m/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
