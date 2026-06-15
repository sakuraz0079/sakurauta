const CACHE_NAME = "sak-uta-app-v98";
const APP_SHELL = [
  "./",
  "./index.html",
  "./share.html",
  "./style.css?v=20260615-10",
  "./app.js?v=20260615-10",
  "./share.css?v=20260615-4",
  "./share.js?v=20260615-4",
  "./icon/sak-chan-face.png",
  "./manifest.webmanifest?v=20260615-6",
  "./icon/IMG_2956.png",
  "./icon/IMG_2957.png",
  "./icon/sak-uta-logo-transparent.png",
  "./icon-192.png?v=20260615-6",
  "./icon-512.png?v=20260615-6",
  "./icon-maskable-512.png?v=20260615-6",
  "./apple-touch-icon.png?v=20260615-6"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))))
    )
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
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
