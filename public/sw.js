// MedRep Connect Pro — cache the public app shell, never payment/API responses.
// Navigation is network-first so a deployed checkout/security fix is not hidden
// behind an older cached index.html after a page refresh.
const CACHE = 'mrc-v4'
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
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('mrc-') && key !== CACHE).map((key) => caches.delete(key)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Do not cache API responses even if a same-origin proxy is added later.
  if (/\/(?:auth|rest|functions)\/v1\//.test(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
        }
        return response
      }).catch(async () => (await caches.match(request)) || (await caches.match('./index.html')) || Response.error()),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone()
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
      }
      return response
    })),
  )
})
