/**
 * S-12 (FR-047): which build of the app this is. Both values are stamped in at build time by
 * `vite.config.ts` (`define`). Under Vitest nothing stamps them, hence the `typeof` guards: an
 * undeclared global read through `typeof` is `undefined`, not a ReferenceError.
 */

declare const __APP_COMMIT__: string | undefined
declare const __APP_BUILT_AT__: string | undefined

/** The short commit the build came from, or `dev` outside a checkout. */
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev'

/** When the build ran, ISO 8601; `undefined` when nothing stamped it. */
export const APP_BUILT_AT: string | undefined = typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : undefined
