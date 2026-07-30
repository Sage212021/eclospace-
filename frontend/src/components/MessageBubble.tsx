import { useI18n } from "../i18n";

// Bulle de messagerie flottante (or) — signale à un destinataire qu'il a des
// messages internes non lus, en plus du point rouge de la barre latérale.
// Décision opérateur : attirer l'attention par une icône bulle dorée qui
//   • s'affiche en bas à droite dès qu'il y a des non-lus ;
//   • s'ouvre sur la messagerie au clic (onOpen) ;
//   • peut être « rabattue » (masquée) via la petite croix (onDismiss) — elle
//     réapparaît à l'arrivée d'un nouveau message.
export function MessageBubble({ count, onOpen, onDismiss }: { count: number; onOpen: () => void; onDismiss: () => void }) {
  const { t } = useI18n();
  const label = count > 1 ? t("chat.bubble.plural", "nouveaux messages") : t("chat.bubble.one", "nouveau message");
  return (
    <div style={wrapStyle}>
      <button type="button" onClick={onOpen} style={bubbleStyle} aria-label={`${count} ${label} — ${t("chat.bubble.open", "ouvrir la messagerie")}`}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
            fill="#fff"
            stroke="#fff"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span style={textStyle}>{count > 1 ? `${count} ${label}` : label}</span>
        {count > 0 && <span style={countStyle} className="num">{count > 99 ? "99+" : count}</span>}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        style={closeStyle}
        aria-label={t("chat.bubble.hide", "Masquer cette bulle")}
        title={t("chat.bubble.hide", "Masquer cette bulle")}
      >
        ×
      </button>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 18,
  zIndex: 60,
  display: "flex",
  alignItems: "flex-start",
  gap: 4,
  // Sous le seuil de sécurité des barres système mobiles.
  paddingBottom: "env(safe-area-inset-bottom, 0)",
};

const bubbleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "var(--eclosion)",
  color: "#fff",
  border: "none",
  borderRadius: 999,
  padding: "11px 18px 11px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 8px 24px rgba(22,35,61,.28)",
};

const textStyle: React.CSSProperties = {
  whiteSpace: "nowrap",
};

const countStyle: React.CSSProperties = {
  background: "#fff",
  color: "var(--eclosion-dark)",
  borderRadius: 999,
  minWidth: 20,
  height: 20,
  padding: "0 6px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
};

const closeStyle: React.CSSProperties = {
  background: "var(--card)",
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: 999,
  width: 22,
  height: 22,
  lineHeight: "18px",
  fontSize: 16,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(22,35,61,.18)",
  padding: 0,
};
