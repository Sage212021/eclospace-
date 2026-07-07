import { useEffect, useState } from "react";
import { listUnreadNotifications } from "../api/client";

interface TopBarProps {
  // Utilisateurs actuellement connectés à l'application (présence temps réel).
  connectedUsers: { userId: string; username: string }[];
}

// Barre supérieure (guide §6) : recherche globale + indicateur de présence
// global (utilisateurs connectés, visible en permanence) + cloche de notifications.
export function TopBar({ connectedUsers }: TopBarProps) {
  const [unreadCount, setUnreadCount] = useState(0);

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
        padding: "12px 24px",
        borderBottom: "1px solid var(--line)",
        background: "var(--card)",
      }}
    >
      <input
        placeholder="Rechercher un ouvrage, un auteur, un ISBN…"
        disabled
        style={{
          flex: 1,
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
    </header>
  );
}
