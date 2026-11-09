import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { isNativeApp } from './data/platform'
import { initNativeApp } from './data/nativeInit'
import { installBootGuard } from './bootGuard'

// Before anything else: if this page cannot start, it must say so rather than
// sit blank. The guard removes itself as soon as the app paints.
installBootGuard()

// The service worker belongs to the deployed website only.
//
//  * Inside the Android app the bundle ships with the APK/AAB (Play delivers the
//    updates), so no worker is registered; initNativeApp() removes any old one.
//  * During development it must never run: sw.js answers asset requests
//    cache-first, so the preview would keep mixing an old React/module graph
//    with new code — the symptom is a blank page or "Cannot read properties of
//    null (reading 'useRef')". Any worker a previous session left behind is
//    removed here, along with its caches, so the next reload is clean.
const devPreview = import.meta.env.DEV

if (!isNativeApp() && 'serviceWorker' in navigator) {
  if (devPreview) {
    // This page may already have loaded half its modules from the old worker,
    // so clean up and reload once — guarded so it can never loop.
    const wasControlled = Boolean(navigator.serviceWorker.controller)
    let alreadyReset = false
    try { alreadyReset = sessionStorage.getItem('mrc-sw-reset') === '1' } catch { /* private mode */ }

    void Promise.all([
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))),
      'caches' in window
        ? caches
          .keys()
          .then((keys) => Promise.all(keys.filter((key) => key.startsWith('mrc-')).map((key) => caches.delete(key))))
        : Promise.resolve([]),
    ])
      .then(() => {
        if (!wasControlled || alreadyReset) return
        try { sessionStorage.setItem('mrc-sw-reset', '1') } catch { /* private mode */ }
        window.location.reload()
      })
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {})
    })
  }
}
initNativeApp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
