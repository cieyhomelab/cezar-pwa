import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const DEFAULT_CEZAR_URL = 'https://cezar.ciey.studio'

// `.env.local` lives at the repo root (it also carries DEPLOY_HOST for
// scripts/deploy.sh), not next to this config.
const envDir = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => {
  // The empty prefix loads unprefixed vars too. They are used ONLY to configure
  // the dev proxy below — never passed to `define`, so no secret can reach the
  // bundle (CLAUDE.md rule 6).
  const env = loadEnv(mode, envDir, '')
  const cezarUrl = env.CEZAR_URL || DEFAULT_CEZAR_URL

  return {
    // The app is always served from https://cezar.ciey.studio/m/ — same-origin
    // is the only arrangement Cezar's #426 guard accepts (CLAUDE.md rule 1).
    base: '/m/',
    envDir,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // injectManifest, not generateSW: we need our own `push` and
        // `notificationclick` handlers (CLAUDE.md).
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        // F-PWA-5: prompt to refresh, never skipWaiting mid-use.
        registerType: 'prompt',
        injectRegister: null,
        manifest: {
          // A stable install identity: without `id` the browser keys the
          // installed app on `start_url`, so changing where the app opens
          // would register as a different app (F-PWA-1).
          id: '/m/',
          name: 'Cezar',
          short_name: 'Cezar',
          description: 'Podgląd i sterowanie agentami Cezara',
          start_url: '/m/',
          scope: '/m/',
          display: 'standalone',
          orientation: 'portrait',
          lang: 'pl',
          background_color: '#0b1117',
          theme_color: '#0b1117',
          icons: [
            { src: '/m/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/m/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/m/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          // Shell only. Nothing under /api/** is precacheable by construction —
          // it is not a build output (CLAUDE.md rule 4).
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // The SW is registered as `classic` (devOptions are off), so it never
          // needed an ESM bundle. The plugin's ESM path also hardcodes Rollup's
          // deprecated `output.inlineDynamicImports`, which Vite 8 warns about
          // and we cannot override; `iife` skips that branch entirely.
          rollupFormat: 'iife',
        },
        devOptions: { enabled: false, type: 'module' },
      }),
    ],
    server: {
      proxy: {
        // Dev against the live Cezar. `changeOrigin` fixes the Host header;
        // `origin` has to be set by hand as well, or the same-origin guard
        // rejects every write with 403 (CLAUDE.md → "Dev na żywym Cezarze").
        '/api': {
          target: cezarUrl,
          changeOrigin: true,
          headers: {
            origin: cezarUrl,
            ...(env.CEZAR_COOKIE ? { cookie: env.CEZAR_COOKIE } : {}),
          },
        },
      },
    },
  }
})
