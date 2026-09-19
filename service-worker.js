// VolleyStats Service Worker
// Caches all app files on first load so the app works offline

const CACHE_NAME = 'volleystats-v1';

// Core files to cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/static/js/main.chunk.js',
  '/static/js/bundle.js',
  '/static/js/vendors~main.chunk.js',
];

// Install — pre-cache core files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can, ignore failures (file names vary per build)
      return cache.addAll(PRECACHE_URLS).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

// Activate — delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', event => {
  // Only handle GET requests to our own origin
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // If no cache for this specific request, return the cached index.html
          // so the app can still boot offline
          return caches.match('/index.html');
        });
      })
  );
});
