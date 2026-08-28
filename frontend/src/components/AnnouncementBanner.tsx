import { useEffect, useState } from "react";
import { getAnnouncementBanner, type AnnouncementBannerItem } from "../api/client";
import { useI18n } from "../i18n";

// Bandeau défilant en tête du tableau de bord : annonces Urgentes/Critiques qui
// ciblent l'utilisateur, visibles dès la connexion. Défilement horizontal en
// CSS (mis en pause au survol) ; chaque annonce s'ouvre au clic. Le bandeau
// disparaît s'il n'y a aucune annonce urgente active.
export function AnnouncementBanner({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<AnnouncementBannerItem[]>([]);

  useEffect(() => {
    getAnnouncementBanner().then(setItems).catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  const hasCritical = items.some((i) => i.priority === "critique");
  // Répète la liste pour un défilement continu sans « saut ».
  const loop = [...items, ...items];

  return (
    <div
      role="region"
      aria-label={t("cm.banner_label", "Annonces importantes")}
      style={{
        background: "var(--navy, #0b0b0c)",
        color: "#fff",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        alignItems: "stretch",
        marginBottom: 18,
        boxShadow: hasCritical ? "0 0 0 2px var(--alert) inset" : "0 0 0 1px rgba(255,255,255,0.08) inset",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "8px 13px",
          background: hasCritical ? "var(--alert)" : "#C4661F",
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          whiteSpace: "nowrap",
        }}
      >
        <span className="ecl-banner-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: "#fff", display: "inline-block" }} />
        {t("cm.banner_title", "À la une")}
      </div>
      <div className="ecl-banner-viewport" style={{ overflow: "hidden", flex: 1, display: "flex", alignItems: "center" }}>
        <div className="ecl-banner-track" style={{ display: "flex", alignItems: "center", gap: 32, paddingLeft: 24 }}>
          {loop.map((item, i) => (
            <button
              key={`${item.id}-${i}`}
              onClick={() => onOpen(item.id)}
              aria-hidden={i >= items.length}
              style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "transparent", border: "none", color: "#fff", cursor: "pointer", whiteSpace: "nowrap", fontSize: 13, padding: 0 }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  color: item.priority === "critique" ? "var(--alert)" : "#F0A868",
                }}
              >
                {item.priority === "critique" ? t("cm.prio.critique", "Critique") : t("cm.prio.urgente", "Urgente")}
              </span>
              <span style={{ fontWeight: 700 }}>{item.title}</span>
              <span style={{ color: "rgba(255,255,255,0.7)" }}>— {item.preview}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
