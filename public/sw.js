// MedRep Connect Pro — cache the public app shell, never payment/API responses,
// and show the phone notifications sent by the send-push Edge Function.
// Navigation is network-first so a deployed checkout/security fix is not hidden
// behind an older cached index.html after a page refresh.
// Bump the cache name whenever the shell changes, so installed clients drop the
// previous bundle instead of keeping a stale login screen.
const CACHE = 'mrc-v8'
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

// ---------------------------------------------------------------------------
// Phone notifications (Web Push)
// ---------------------------------------------------------------------------

// Sound and vibration are requested on the notification itself: while the app is
// closed this is the only way to reach the user, and the operating system decides
// the exact tone (Android uses the notification channel's sound).
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'MedRep Connect Pro'
  const body = typeof payload.body === 'string' && payload.body.trim()
    ? payload.body.trim()
    : 'Tap to open the app.'

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: typeof payload.tag === 'string' && payload.tag ? payload.tag : 'mrc-update',
    // Replace an earlier notice with the same tag, and buzz again for the new one.
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      url: typeof payload.url === 'string' && payload.url ? payload.url : './index.html',
      notificationId: typeof payload.notificationId === 'string' ? payload.notificationId : null,
    },
  }))
})

// Tapping the notification opens (or focuses) the app instead of a browser tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const target = new URL(data.url || './index.html', self.location.href).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        client.postMessage({ type: 'mrc-notification-click', notificationId: data.notificationId || null })
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target)
  })())
})
