/// <reference types="vite/client" />

/**
 * Compile-time app version, injected by vite.config.ts from the "version"
 * field of package.json (the single source of truth for releases).
 */
declare const __APP_VERSION__: string

/**
 * Notification keys. Optional: the public VAPID key normally comes from the
 * send-push function (`config` action), so a deployed project needs nothing here.
 * Set it only to test locally before the function is deployed.
 */
interface ImportMetaEnv {
  readonly VITE_VAPID_PUBLIC_KEY?: string
}
