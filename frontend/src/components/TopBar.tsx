import { useEffect, useState } from "react";
import { listUnreadNotifications } from "../api/client";

interface TopBarProps {
  // Utilisateurs actuellement connectés à l'application (présence temps réel).
  connectedUsers: { userId: string; username: string }[];
  // Sur mobile : ouvre le menu latéral escamotable (bouton ☰ à gauche).
  onMenu?: () => void;
  // Profil courant + actions du menu (déconnexion, accès aux paramètres).
  user: { username: string; email: string };
  onLogout: () => void;
  onOpenSettings?: () => void;
}

function initials(username: string): string {
  const parts = username.replace(/[_.-]+/g, " ").trim().split(/\s+/);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return letters.toUpperCase();
}

// Barre supérieure (guide §6) : recherche globale + présence + notifications +
// menu de profil (avatar) à droite, façon Microsoft 365 / Notion.
export function TopBar({ connectedUsers, onMenu, user, onLogout, onOpenSettings }: TopBarProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    listUnreadNotifications()
      .then((notifications) => setUnreadCount(notifications.length))
      .catch(() => setUnreadCount(0));
  }, []);

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
      <input
        placeholder="Rechercher un ouvrage, un auteur, un ISBN…"
        disabled
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 420,
          padding: "8px 12px",
          border: "1px solid var(--line)",
          borderRadius: 6,
          fontSize: 13,
          color: "var(--muted)",
        }}
      />
      <div
        title={
          connectedUsers.length > 0
            ? `Connectés : ${connectedUsers.map((u) => u.username).join(", ")}`
            : "Aucun autre utilisateur connecté"
        }
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--eclosion)", display: "inline-block" }} />
        <span style={{ fontFamily: "var(--font-mono)" }}>{connectedUsers.length}</span> en ligne
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
