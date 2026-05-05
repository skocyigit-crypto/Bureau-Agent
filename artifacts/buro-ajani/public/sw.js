const CACHE_NAME = "adb-cache-v3";
const STATIC_ASSETS = ["/favicon.svg", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache SSE sync stream or API calls
  if (url.pathname.includes("/api/sync/events")) return;
  if (url.pathname.includes("/api/")) return;

  // Navigation: network-first, fallback to cache then offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Static assets (JS/CSS/fonts/icons): stale-while-revalidate
  if (
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|svg|png|jpg|webp|ico)$/)
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const fresh = fetch(request).then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          });
          return cached || fresh;
        })
      )
    );
    return;
  }
});

// Listen for messages from clients (e.g. skipWaiting trigger)
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
