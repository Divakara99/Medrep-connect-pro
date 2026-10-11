/// <reference types="vite/client" />

/**
 * Compile-time app version, injected by vite.config.ts from the "version"
 * field of package.json (the single source of truth for releases).
 */
declare const __APP_VERSION__: string
