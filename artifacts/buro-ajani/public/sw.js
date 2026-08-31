const CACHE_NAME = "adb-cache-v4";
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

  // Le Cache Storage n'accepte que http/https. Les extensions de navigateur
  // emettent des requetes en `chrome-extension:` (et equivalents) qui passent
  // par le service worker: tenter de les mettre en cache levait
  // "Request scheme 'chrome-extension' is unsupported" a chaque chargement,
  // polluant la console des utilisateurs avec une erreur qui ne vient meme pas
  // de l'application.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Never cache SSE sync stream or API calls
  if (url.pathname.includes("/api/sync/events")) return;
  if (url.pathname.includes("/api/")) return;

  // Navigation: network-first, fallback to cache then offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Ne mettre en cache que les reponses valides.
          //
          // La branche des assets statiques verifie `res.ok`, pas celle-ci:
          // toute reponse etait stockee, y compris un 502 servi pendant un
          // deploiement. Cette page d'erreur devenait alors le repli hors
          // ligne, et l'utilisateur la revoyait a la place de la derniere
          // page valide.
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone)).catch(() => {});
          }
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
            if (res.ok) cache.put(request, res.clone()).catch(() => {});
            return res;
          });
          // Quand une copie est deja en cache, `fresh` continue en arriere-plan
          // et personne ne l'attend: hors ligne, son rejet remontait en
          // "unhandled rejection" dans la console a chaque asset charge.
          if (cached) {
            fresh.catch(() => {});
            return cached;
          }
          return fresh;
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
