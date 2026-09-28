const CACHE = 'kilometrina-v5';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Tell the app that a newer version has been downloaded (it offers "Osveži").
// A page that opens before the download finishes gets the broadcast; one that
// is still starting up asks with 'kilometrina-hello' and gets the answer then.
let updateWaiting = false;
function announceUpdate() {
  updateWaiting = true;
  self.clients.matchAll({ type: 'window' }).then((list) => list.forEach((c) => c.postMessage({ type: 'kilometrina-update' })));
}
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'kilometrina-hello' && updateWaiting && event.source) event.source.postMessage({ type: 'kilometrina-update' });
});

// Stale-while-revalidate for the app's own files: open instantly from the
// cache, fetch a fresh copy in the background for next time. no-cache makes
// that fetch ask GitHub Pages instead of the browser's 10-minute HTTP cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let Google requests pass through untouched
  const page = req.mode === 'navigate';
  // every navigation (also ?code=… from the Oura login) is the same app page
  const key = page ? self.registration.scope : req;

  if (page) updateWaiting = false; // a fresh page load; only this load's check counts
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: page });
    // read the cached page now — once it is handed to the browser it can't be cloned any more
    const before = page && cached ? cached.clone().text() : null;
    const fresh = fetch(req, { cache: 'no-cache' }).then(async (res) => {
      if (res && res.ok && res.type === 'basic') {
        const after = before ? res.clone().text() : null;
        await cache.put(key, res.clone());
        if (before && (await before) !== (await after)) announceUpdate();
      }
      return res;
    });
    if (cached) {
      event.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    return fresh.catch(() => cache.match(key, { ignoreSearch: true }));
  })());
});
