// MedRep Connect Pro — simple service worker (offline shell caching)
// All paths are relative to the SW scope so the app works from any host or
// sub-path (e.g. GitHub Pages project sites).
const CACHE = 'mrc-v3'
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  // Never cache API/other-origin requests
  if (new URL(req.url).origin !== self.location.origin) return
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const copy = resp.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return resp
        })
        .catch(() => cached || caches.match('./index.html'))
      return cached || fetchPromise
    })
  )
})
