import { useEffect, useState } from "react";
import { listUnreadNotifications } from "../api/client";

// Barre supérieure (guide §6) : recherche globale + cloche de notifications.
// La recherche globale (Ch. 5 §5.4) n'est pas encore spécifiée côté API au
// Lot 0 : le champ est affiché à titre de coquille, sans appel réseau.
export function TopBar() {
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
