import { defineConfig, devices } from '@playwright/test'

// Mobile Safari is the primary target (CLAUDE.md), so the only project is
// WebKit at iPhone dimensions. WebKit is not installed by default — run
// `npx playwright install webkit` once before the first E2E run.
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // The PWA is always served under /m/ (nginx alias in production, Vite base
    // in dev), so every relative navigation has to resolve inside that scope.
    baseURL: 'http://localhost:4173/m/',
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
    command:
      'npm run build -w @cezar-pwa/pwa && npm run preview -w @cezar-pwa/pwa -- --port 4173 --strictPort',
    url: 'http://localhost:4173/m/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
