// Service worker minimal d'Eclospace — rend l'application « installable » (PWA)
// et fournit une coquille de secours hors ligne, SANS jamais mettre en cache les
// données (l'API reste toujours en direct : un ERP doit montrer l'état réel).
//
// Stratégie volontairement sobre (règle n°6 : simplicité) :
//   • navigation → réseau d'abord, repli sur l'index en cache si hors ligne ;
//   • API (/api/*) → jamais de cache, toujours le réseau ;
//   • le reste → comportement navigateur par défaut.
// Incrémenter la version ci-dessous force le remplacement de l'ancien cache.

const CACHE = "eclospace-shell-v5";
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

// ── Notifications « Web Push » ───────────────────────────────────────────────
// Réception d'une notification envoyée par le serveur, MÊME application fermée.
// Le contenu (titre, corps) est déjà ciblé côté serveur sur le bon destinataire.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Eclospace";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.entityType && data.entityId ? `${data.entityType}:${data.entityId}` : undefined,
    silent: data.silent === true,
    data: { entityType: data.entityType || null, entityId: data.entityId || null, category: data.category || null },
  };
  // Met à jour le COMPTEUR sur l'icône de l'application (écran d'accueil), même
  // application fermée : le serveur envoie le total de non-lus du destinataire
  // dans `data.badge`. L'API « Badging » est ignorée là où elle n'existe pas.
  const setBadge = async () => {
    if (typeof data.badge !== "number") return;
    try {
      if (data.badge > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(data.badge);
      else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
    } catch {
      /* API indisponible : sans effet */
    }
  };
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), setBadge()]));
});

// Clic sur la notification : ouvre Eclospace (ou ramène l'onglet déjà ouvert au
// premier plan) plutôt que d'ouvrir une nouvelle page à chaque fois.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    }),
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
