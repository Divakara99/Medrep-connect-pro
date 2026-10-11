/**
 * App version shown in the UI.
 *
 * Single source of truth = the "version" field in package.json, injected at
 * build time by vite.config.ts as the __APP_VERSION__ constant (declared in
 * src/vite-env.d.ts). Nothing here is hand-maintained, so the badge shown on
 * the login screen, the account screen and the admin panel can never disagree
 * with the released version.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : '0.0.0'

/** Human-facing form used by the UI, e.g. "v1.0.0". */
export const APP_VERSION_LABEL = `v${APP_VERSION}`
