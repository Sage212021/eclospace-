// Service worker minimal d'Eclospace — rend l'application « installable » (PWA)
// et fournit une coquille de secours hors ligne, SANS jamais mettre en cache les
// données (l'API reste toujours en direct : un ERP doit montrer l'état réel).
//
// Stratégie volontairement sobre (règle n°6 : simplicité) :
//   • navigation → réseau d'abord, repli sur l'index en cache si hors ligne ;
//   • API (/api/*) → jamais de cache, toujours le réseau ;
//   • le reste → comportement navigateur par défaut.
// Incrémenter la version ci-dessous force le remplacement de l'ancien cache.

const CACHE = "eclospace-shell-v3";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // données dynamiques : jamais en cache

  // Ouverture de l'application : on tente le réseau (donc toujours à jour), et
  // l'on ne sert la coquille en cache qu'en cas d'absence de réseau.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
  }
});
