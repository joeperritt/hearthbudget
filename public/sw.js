// Minimal network-only service worker: exists only so Chrome offers "Install".
// It caches nothing, so a new publish is always picked up immediately.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only: let the browser handle every request */ });
