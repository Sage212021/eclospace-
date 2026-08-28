import { Component, type ReactNode } from "react";

// Filet de sécurité global. Sans lui, la moindre erreur de rendu — ou, très
// fréquent après un redéploiement, un « morceau » de l'application (chunk) qui
// n'existe plus côté serveur alors qu'une page était ouverte — laisse un ÉCRAN
// BLANC définitif : l'utilisateur est obligé de fermer l'application.
//
// Ici, on RÉCUPÈRE au lieu de planter :
//   • erreur de chargement d'un morceau (après mise à jour) → on recharge UNE
//     fois pour récupérer la nouvelle version (garde-fou anti-boucle) ;
//   • toute autre erreur → un écran lisible avec un bouton « Recharger », plutôt
//     qu'une page blanche.

function isChunkLoadError(err: unknown): boolean {
  const s = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|imported module script failed|Failed to fetch/i.test(s);
}

// Rechargement « propre » : on vide les caches du service worker pour être sûr de
// récupérer la toute dernière version, puis on recharge la page.
function hardReload(): void {
  const reload = () => window.location.reload();
  if ("caches" in window) {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => undefined).finally(reload);
  } else {
    reload();
  }
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    if (isChunkLoadError(error)) {
      // Une seule tentative de rechargement automatique (anti-boucle) : si le
      // dernier rechargement « chunk » date de moins de 15 s, on ne recharge pas
      // et on laisse l'écran de secours avec le bouton manuel.
      const KEY = "eclospace_chunk_reload_at";
      const last = Number(sessionStorage.getItem(KEY) || "0");
      if (Date.now() - last > 15000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        hardReload();
      }
    }
  }

  private reload = () => hardReload();

  render(): ReactNode {
    if (this.state.error) {
      const chunk = isChunkLoadError(this.state.error);
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F8F9FB", color: "#0b0b0c", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
          <div style={{ maxWidth: 460, textAlign: "center", background: "#fff", border: "1px solid #e6e9ef", borderRadius: 14, padding: "28px 24px", boxShadow: "0 6px 24px rgba(22,35,61,0.08)" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
            <h1 style={{ fontSize: 19, margin: "0 0 8px" }}>Éclospace doit être rechargé</h1>
            <p style={{ fontSize: 14, color: "#5b6472", lineHeight: 1.5, margin: "0 0 18px" }}>
              {chunk
                ? "Une nouvelle version de l'application a été déployée. Cliquez sur « Recharger » pour la récupérer — aucune donnée n'est perdue."
                : "Un incident d'affichage est survenu. Cliquez sur « Recharger » pour repartir sur une page saine — aucune donnée n'est perdue."}
            </p>
            <button onClick={this.reload} style={{ border: "none", background: "#0b0b0c", color: "#fff", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Recharger l'application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
