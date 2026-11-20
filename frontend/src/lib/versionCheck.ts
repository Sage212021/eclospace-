// Détection d'une NOUVELLE VERSION déployée.
//
// L'application est une PWA : une fois ouverte, elle peut rester en mémoire
// (surtout « ajoutée à l'écran d'accueil ») sans jamais se recharger — l'ancien
// code continue donc de tourner même après une mise en ligne. Résultat fréquent :
// « la modification n'est pas prise en compte ».
//
// Ici on compare, à intervalles réguliers et au retour sur l'application, la
// version EN COURS D'EXÉCUTION (`__BUILD_ID__`, figé dans le bundle au build) à
// la version réellement EN LIGNE (`/version.json`, réécrit à chaque build). Dès
// qu'elles diffèrent, on affiche un bandeau « Nouvelle version — toucher pour
// mettre à jour » : un seul geste recharge et applique la mise à jour.

const CURRENT = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "";

let shown = false;

function reload() {
  try {
    location.reload();
  } catch {
    /* sans effet : l'utilisateur peut recharger à la main */
  }
}

function showBanner() {
  if (shown || typeof document === "undefined" || !document.body) return;
  shown = true;
  const bar = document.createElement("div");
  bar.setAttribute("role", "button");
  bar.tabIndex = 0;
  bar.textContent = "🔄 Nouvelle version disponible — toucher pour mettre à jour";
  Object.assign(bar.style, {
    position: "fixed",
    left: "0",
    right: "0",
    top: "0",
    zIndex: "2147483647",
    background: "#D9B21A",
    color: "#0B0B0C",
    font: "700 14px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    padding: "11px 16px",
    textAlign: "center",
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(11,11,12,.28)",
  } as Partial<CSSStyleDeclaration>);
  bar.addEventListener("click", reload);
  bar.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") reload();
  });
  document.body.appendChild(bar);
}

async function check() {
  if (shown) return;
  try {
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json().catch(() => null)) as { build?: string } | null;
    const build = data && typeof data.build === "string" ? data.build : "";
    if (build && CURRENT && build !== CURRENT) showBanner();
  } catch {
    /* hors ligne / erreur réseau : on réessaiera au prochain cycle */
  }
}

// Démarre la surveillance. Sans effet en développement (pas de build déployé).
export function startVersionCheck(): void {
  if (!import.meta.env.PROD || !CURRENT) return;
  // Pousse aussi le service worker à se rafraîchir.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  }
  void check();
  window.setInterval(() => void check(), 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.addEventListener("focus", () => void check());
}
