// Perritt service worker: app shell caching, "Install", and push notifications.
// - /assets/* (hashed build files): cache-first.
// - Page loads: stale-while-revalidate (cached page now, fresh copy fetched for next open).
// - Icons/manifest: stale-while-revalidate.
// - Everything else (backend, functions, Google, weather, cross-origin, non-GET): network only.
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `perritt-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `perritt-assets-${CACHE_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];
const STATIC_FILES = new Set(['/manifest.webmanifest', '/favicon.png', '/favicon-16.png', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']);
const PAGE_KEY = '/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  try {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('perritt-') && !CURRENT_CACHES.includes(n)).map((n) => caches.delete(n)));
  } catch { /* ignore */ }
  await self.clients.claim();
})()));

function cacheable(res) { return res && res.ok && res.status === 200 && res.type === 'basic'; }

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(event, request, key) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(key, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    const type = res.headers.get('content-type') || '';
    if (cacheable(res) && (key !== PAGE_KEY || type.includes('text/html'))) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    event.waitUntil(network.catch(() => {}));
    return hit;
  }
  return network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // backend, Google, weather, etc.
  const path = url.pathname;
  if (path.startsWith('/~') || path.startsWith('/functions/') || path.startsWith('/rest/') || path.startsWith('/auth/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, request, PAGE_KEY));
    return;
  }
  if (path.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (STATIC_FILES.has(path)) {
    event.respondWith(staleWhileRevalidate(event, request, path));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || '', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

// Pass the payload URL through untouched. If an app window is already open, focus it,
// try to navigate, and if that fails, message the URL so the app handles it itself.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  const url = target.href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      try { await c.focus(); } catch { /* ignore */ }
      let navigated = null;
      try { navigated = await c.navigate(url); } catch { navigated = null; }
      if (!navigated) c.postMessage({ type: 'open-url', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
