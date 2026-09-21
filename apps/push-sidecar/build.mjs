// Bundles the sidecar into ONE file, `dist/cezar-push.mjs`, which is all the host needs:
// `deploy/push/install.sh` copies it and nothing else. web-push is CommonJS, so the bundle gets a
// real `require` for the Node built-ins it asks for.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/cezar-push.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  // The host runs Node 20 (REQUIREMENTS § 6: Node 20+).
  target: 'node20',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
})
