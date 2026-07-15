import { useI18n } from "../i18n";
import type { AnnouncementPush } from "../hooks/usePresence";

const PRIORITY_COLORS: Record<AnnouncementPush["priority"], string> = {
  normale: "var(--muted)",
  importante: "var(--eclosion)",
  urgente: "#C4661F",
  critique: "var(--alert)",
};

export interface ToastItem extends AnnouncementPush {
  toastId: number;
}

// Pop-up d'aperçu d'une nouvelle annonce (temps réel). S'affiche en bas à droite,
// s'efface seule au bout de quelques secondes, et ouvre l'annonce au clic.
// Respecte la préférence « notifications visuelles » de l'utilisateur (le parent
// ne monte le composant que si elle est activée).
export function AnnouncementToasts({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: ToastItem[];
  onOpen: (id: string) => void;
  onDismiss: (toastId: number) => void;
}) {
  const { t } = useI18n();
  if (toasts.length === 0) return null;

  return (
    <div aria-live="polite" style={{ position: "fixed", right: 16, bottom: 16, zIndex: 90, display: "flex", flexDirection: "column", gap: 10, maxWidth: "min(360px, 92vw)" }}>
      {toasts.map((toast) => (
        <div
          key={toast.toastId}
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderLeft: `4px solid ${PRIORITY_COLORS[toast.priority]}`,
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(9, 16, 33, 0.18)",
            padding: "11px 12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: PRIORITY_COLORS[toast.priority], textTransform: "uppercase", letterSpacing: 0.4 }}>
              {t("cm.new_announcement", "Nouvelle annonce")}
            </span>
            <button
              onClick={() => onDismiss(toast.toastId)}
              aria-label={t("cm.dismiss", "Fermer")}
              style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
            >
              ✕
            </button>
          </div>
          <button
            onClick={() => onOpen(toast.id)}
            style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 4 }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{toast.title}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {toast.preview}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--eclosion-dark)", marginTop: 5 }}>{t("cm.open", "Ouvrir")} →</div>
          </button>
        </div>
      ))}
    </div>
  );
}
