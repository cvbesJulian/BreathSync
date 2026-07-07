// BreathSync offline caching service worker.
// Network-first so active development always sees fresh files when online,
// with a cache fallback for offline use. Caching only; no messaging.
const CACHE = "breathsync-v2.0.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./popup.css",
  "./popup.js",
  "./chrome-shim.js",
  "./listen.html",
  "./listen.css",
  "./listen.js",
  "./midi-permission.html",
  "./midi-permission.css",
  "./midi-permission.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});
