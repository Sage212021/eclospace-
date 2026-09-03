import { lazy, type ComponentType } from "react";

// Chargement à la demande RÉSILIENT. Après un redéploiement, un écran ouvert
// peut réclamer un « morceau » (chunk) dont le nom a changé : le navigateur
// détient encore l'ancienne liste et le fichier demandé n'existe plus côté
// serveur. Sans garde-fou, l'import échoue et l'écran reste DÉFINITIVEMENT
// vide (Suspense figé), ce qui donne l'impression que « la page ne charge pas ».
//
// Ici, on récupère au lieu de rester bloqué :
//   1) on retente l'import une fois (petite latence réseau passagère) ;
//   2) si l'échec ressemble à un morceau manquant/périmé et qu'on n'a pas déjà
//      rechargé très récemment (garde anti-boucle), on force UN rechargement
//      propre pour récupérer la nouvelle version — l'utilisateur retombe sur
//      l'écran voulu, sans page blanche.

const RELOAD_KEY = "eclospace_lazy_reload_at";

function looksLikeStaleChunk(err: unknown): boolean {
  const s = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|imported module script failed|Failed to fetch|error loading dynamically/i.test(s);
}

function hardReloadOnce(): void {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
  } catch {
    /* stockage indisponible */
  }
  // Un seul rechargement automatique par fenêtre de 15 s (anti-boucle).
  if (Date.now() - last < 15000) return;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  const reload = () => window.location.reload();
  if ("caches" in window) {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => undefined).finally(reload);
  } else {
    reload();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      // Deuxième tentative après une courte pause (aléa réseau).
      try {
        await new Promise((r) => setTimeout(r, 400));
        return await factory();
      } catch (err2) {
        // Morceau périmé après déploiement : on recharge pour récupérer la
        // nouvelle version. On relance quand même l'erreur (le rechargement
        // remplace la page ; l'ErrorBoundary global sert de dernier filet).
        if (looksLikeStaleChunk(err2) || looksLikeStaleChunk(err)) hardReloadOnce();
        throw err2;
      }
    }
  });
}
