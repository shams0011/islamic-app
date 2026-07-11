// ══ Service Worker — Islamic AI App ══
// Strategy:
//   - App shell (index.html, manifest.json): cache-first, with background update check
//   - Hadith data (hadith-data/**): cache-as-you-browse — once a chapter is fetched, it's
//     cached for offline use afterward, without pre-downloading the entire ~136MB dataset
//   - Everything else (Anthropic API calls, geolocation/time APIs): always network, never cached
//     (these need live data and must not be served stale)

const CACHE_VERSION = 'v165';
const SHELL_CACHE = `islamic-ai-shell-${CACHE_VERSION}`;
const DATA_CACHE = `islamic-ai-data-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/kalima.svg',
  './fonts/scheherazade-new-700-arabic.woff2',
  './fonts/kfgqpc-uthmanic-hafs.woff2',
  './fonts/amiri-quran-arabic.woff2',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isHadithDataRequest(url) {
  return /\/hadith-data\/|\/(bukhari|muslim|tirmizi|abudawud|nasai|ibnmajah)\/(index|ch\d+)\.json$/.test(url)
    || /\/quran-data\/|\/quran-data\/(index|surah\d+)\.json$/.test(url);
}

function isExternalApi(url) {
  return url.includes('api.anthropic.com')
    || url.includes('worldtimeapi.org')
    || url.includes('timeapi.io')
    || url.includes('ipapi.co')
    || url.includes('nominatim.openstreetmap.org')
    || url.includes('overpass-api.de')
    || url.includes('api.quran.com')
    || url.includes('cdn.islamic.network')
    || url.includes('everyayah.com')
    || url.includes('unpkg.com')          // Leaflet library (mosque map)
    || url.includes('cartocdn.com')       // dark map tiles — never cache, unbounded
    || url.includes('project-osrm.org')   // in-app routing
    || url.includes('hisnmuslim.com')     // hadith dua audio — stream, never cache
    || url.includes('openstreetmap.org');
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache POST (e.g. AI chat calls)

  const url = req.url;

  // Never cache live external APIs — always go to network
  if (isExternalApi(url)) {
    return; // let the browser handle it natively, no SW intervention
  }

  // Hadith JSON data: cache-as-you-browse (network-first, fall back to cache when offline,
  // and populate the cache as a side effect of every successful fetch)
  if (isHadithDataRequest(url)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // App shell: cache-first for instant load, with a background revalidation so updates
  // still propagate on the next visit
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached); // offline and not cached — nothing we can do for a new file
      return cached || networkFetch;
    })
  );
});
