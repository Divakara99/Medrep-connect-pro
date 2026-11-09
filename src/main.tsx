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

// The service worker belongs to the website only. Inside the Android app the
// bundle ships with the APK/AAB (Play delivers updates), so no worker is
// registered there and any stale one is removed by initNativeApp().
if (!isNativeApp() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
initNativeApp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
