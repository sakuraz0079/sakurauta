const CACHE_NAME = "sak-uta-app-v40";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=20260602-21",
  "./app.js?v=20260602-21",
  "./manifest.webmanifest",
  "./icon/IMG_2956.png",
  "./icon/IMG_2957.png",
  "./icon/sak-uta-logo-transparent.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.destination === "audio") return;
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        if (request.method === "GET" && new URL(request.url).origin === location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
