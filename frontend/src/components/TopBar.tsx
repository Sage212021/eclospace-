import { useEffect, useRef, useState } from "react";
import { listUnreadNotifications, quickSearch, type QuickSearchResult } from "../api/client";

interface TopBarProps {
  // Nombre de personnes connectées (présence temps réel, sans identités).
  connectedTotal: number;
  // Effectif présent par pôle (compteurs seuls) pour la fenêtre « Hall ».
  poles: { label: string; count: number }[];
  // Sur mobile : ouvre le menu latéral escamotable (bouton ☰ à gauche).
  onMenu?: () => void;
  // Profil courant + actions du menu (déconnexion, accès aux paramètres).
  user: { username: string; email: string };
  onLogout: () => void;
  onOpenSettings?: () => void;
  // Ouvre la fiche d'un ouvrage depuis un résultat de recherche.
  onOpenManuscript?: (id: string) => void;
}

function initials(username: string): string {
  const parts = username.replace(/[_.-]+/g, " ").trim().split(/\s+/);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return letters.toUpperCase();
}

// Barre supérieure (guide §6) : recherche globale + présence + notifications +
// menu de profil (avatar) à droite, façon Microsoft 365 / Notion.
export function TopBar({ connectedTotal, poles, onMenu, user, onLogout, onOpenSettings, onOpenManuscript }: TopBarProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hallOpen, setHallOpen] = useState(false);

  // Recherche rapide : requête saisie, résultats et état d'ouverture du menu
  // déroulant. La recherche part après une courte pause de frappe (anti-rebond)
  // pour ne pas solliciter le serveur à chaque touche.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listUnreadNotifications()
      .then((notifications) => setUnreadCount(notifications.length))
      .catch(() => setUnreadCount(0));
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      quickSearch(term)
        .then((data) => setResults(data.results))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // Ferme le menu déroulant quand on clique en dehors de la zone de recherche.
  useEffect(() => {
    if (!searchOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [searchOpen]);

  function openResult(id: string) {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    onOpenManuscript?.(id);
  }

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px clamp(12px, 3vw, 24px)",
        borderBottom: "1px solid var(--line)",
        background: "var(--card)",
      }}
    >
      {/* Bouton ☰ : la classe app-menu-btn le masque sur grand écran et
          l'affiche sous 900px (média-requête, pas de JS). */}
      {onMenu && (
        <button onClick={onMenu} aria-label="Ouvrir le menu" className="app-menu-btn">
          ☰
        </button>
      )}
      {/* Recherche rapide : au fil de la frappe, un menu déroulant présente les
          ouvrages correspondants (titre, auteur, ISBN). Cliquer un résultat
          ouvre sa fiche. La présentation générale reste inchangée : le champ
          garde sa place et son style, seul le déroulé s'ajoute au clic. */}
      <div ref={searchBoxRef} style={{ position: "relative", flex: 1, minWidth: 0, maxWidth: 420 }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Rechercher un ouvrage, un auteur, un ISBN…"
          aria-label="Recherche rapide"
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid var(--line)",
            borderRadius: 6,
            fontSize: 13,
            color: "var(--ink)",
          }}
        />
        {searchOpen && query.trim().length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 61,
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              boxShadow: "0 12px 32px rgba(9, 16, 33, 0.18)",
              overflow: "hidden",
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {searching && results.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--muted)" }}>Recherche…</div>
            )}
            {!searching && results.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--muted)" }}>
                Aucun ouvrage ne correspond à « {query.trim()} ».
              </div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => openResult(r.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--line)",
                  padding: "10px 14px",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f6fa")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{r.manuscriptNumber}</span>
                  {r.author && <span>· {r.author}</span>}
                  {r.isbn && <span style={{ fontFamily: "var(--font-mono)" }}>· {r.isbn}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Présence : nombre de personnes connectées, sans aucune identité
          (confidentialité). Cliquer ouvre la fenêtre « Hall / Présence » qui
          détaille l'activité pôle par pôle (actif/inactif + effectif), toujours
          sans nommer personne. */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setHallOpen((v) => !v)}
          aria-label="Voir la présence par pôle"
          aria-expanded={hallOpen}
          title={`${connectedTotal} personne(s) connectée(s) — voir par pôle`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--muted)",
            whiteSpace: "nowrap",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "4px 2px",
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--eclosion)", display: "inline-block" }} />
          <span style={{ fontFamily: "var(--font-mono)" }}>{connectedTotal}</span> en ligne
        </button>

        {hallOpen && (
          <>
            <div onClick={() => setHallOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} aria-hidden="true" />
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                zIndex: 61,
                width: 288,
                maxWidth: "80vw",
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "0 12px 32px rgba(9, 16, 33, 0.18)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Hall — présence</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{connectedTotal}</span> en ligne
                </span>
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {poles.map((p) => {
                  const active = p.count > 0;
                  return (
                    <div
                      key={p.label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 14px",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--ink)" }}>
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 999,
                            background: active ? "var(--success)" : "var(--line)",
                            display: "inline-block",
                            flexShrink: 0,
                          }}
                        />
                        {p.label}
                      </span>
                      <span style={{ fontSize: 12, color: active ? "var(--ink)" : "var(--muted)" }}>
                        {active ? (
                          <>
                            <span style={{ fontFamily: "var(--font-mono)" }}>{p.count}</span> présent{p.count > 1 ? "s" : ""}
                          </>
                        ) : (
                          "personne"
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--muted)" }}>
                Effectifs par pôle — sans identités (confidentialité).
              </div>
            </div>
          </>
        )}
      </div>
      <div style={{ position: "relative", fontSize: 18 }} title={`${unreadCount} notification(s) non lue(s)`}>
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -8,
              background: "var(--alert)",
              color: "#fff",
              borderRadius: 999,
              fontSize: 10,
              padding: "1px 5px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {unreadCount}
          </span>
        )}
      </div>

      {/* Menu de profil : avatar (initiales) → identité + Paramètres + Déconnexion. */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu du profil"
          aria-expanded={menuOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 2,
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              background: "linear-gradient(180deg, var(--eclosion-light), var(--eclosion))",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12.5,
              fontWeight: 700,
              letterSpacing: 0.3,
            }}
          >
            {initials(user.username)}
          </span>
        </button>

        {menuOpen && (
          <>
            {/* Zone cliquable pour fermer le menu en cliquant ailleurs. */}
            <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} aria-hidden="true" />
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                zIndex: 61,
                width: 248,
                maxWidth: "80vw",
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "0 12px 32px rgba(9, 16, 33, 0.18)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", wordBreak: "break-word" }}>{user.username}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", wordBreak: "break-word" }}>{user.email}</div>
              </div>
              {onOpenSettings && (
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings();
                  }}
                >
                  Paramètres du compte
                </MenuItem>
              )}
              <MenuItem
                danger
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
              >
                Se déconnecter
              </MenuItem>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "10px 14px",
        fontSize: 13,
        cursor: "pointer",
        color: danger ? "var(--alert)" : "var(--ink)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "var(--alert-soft)" : "#f4f6fa")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
