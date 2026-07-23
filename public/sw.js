/**
 * Markec AI Firm Service Worker
 * v1.5 — basic offline support + background sync
 *
 * Strategy:
 * - App shell (HTML, JS, CSS, fonts): stale-while-revalidate
 * - API calls: network-first (fall back to cache if offline)
 * - Static assets (images): cache-first
 */

const CACHE_VERSION = 'markec-ai-firm-v1.5';
const APP_SHELL = [
  '/',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET requests
  if (req.method !== 'GET') return;

  // Skip cross-origin (Telegram, Discord, Bolha, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip Next.js HMR + dev artifacts
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // API calls: network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Static assets (images, icons): cache-first
  if (req.destination === 'image' || /\.(png|jpg|jpeg|gif|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // App shell (HTML, JS, CSS): stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

async function cacheFirst(req) {
  try {
    const cached = await caches.match(req);
    if (cached) return cached;
  } catch (e) { /* ignore */ }
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, res.clone());
      } catch (e) { /* ignore */ }
    }
    return res;
  } catch (e) {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok && req.method === 'GET') {
      try {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, res.clone());
      } catch (e) { /* ignore */ }
    }
    return res;
  } catch (e) {
    try {
      const cached = await caches.match(req);
      if (cached) return cached;
    } catch (ce) { /* ignore */ }
    return new Response(
      JSON.stringify({ error: 'Offline — preveri internetno povezavo', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function staleWhileRevalidate(req) {
  let cached = null;
  try {
    cached = await caches.match(req);
  } catch (e) { /* ignore */ }
  const fetchPromise = fetch(req).then(function(res) {
    if (res && res.ok) {
      try {
        caches.open(CACHE_VERSION).then(function(c) { c.put(req, res.clone()); });
      } catch (e) { /* ignore */ }
    }
    return res;
  }).catch(function() { return cached; });
  return cached || fetchPromise;
}

// Handle push notifications from server
self.addEventListener('push', (event) => {
  let data = { title: 'Markec AI Firm', body: 'Nova priložnost!', url: '/' };
  try {
    if (event.data) data = event.data.json();
  } catch { /* keep default */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
      tag: 'markec-alert',
      renotify: true,
    })
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Background sync for retrying failed cron requests
self.addEventListener('sync', (event) => {
  if (event.tag === 'markec-cron-sync') {
    event.waitUntil(retryCron());
  }
});

async function retryCron() {
  try {
    await fetch('/api/cron/run-all', { method: 'POST' });
  } catch {
    // Will be retried on next sync
  }
}
