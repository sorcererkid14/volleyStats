// VolleyStats Service Worker v1
const CACHE_NAME = 'volleystats-v1';

// On install — cache the shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache the root — this is the app shell
      return cache.add('/').catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

// On activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache everything as it's requested (cache-first for assets, network-first for HTML)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // For JS/CSS/font assets (they have hashes in filename — safe to cache forever)
  if (
    url.pathname.includes('/_expo/static/') ||
    url.pathname.includes('/assets/') ||
    url.pathname.match(/\.(js|css|ttf|woff|woff2|png|jpg|ico)$/)
  ) {
    // Cache first — these files never change (hash in filename)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // For HTML / navigation — network first, fall back to cached index.html
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — serve cached version or fall back to root
        return caches.match(event.request)
          .then(cached => cached || caches.match('/'));
      })
  );
});