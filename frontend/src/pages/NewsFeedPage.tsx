import { useEffect, useState } from "react";
import { getNewsfeed, type NewsfeedItem } from "../api/client";
import { useI18n } from "../i18n";

const PRIORITY_COLORS: Record<string, string> = {
  normale: "var(--muted)",
  importante: "var(--eclosion)",
  urgente: "#C4661F",
  critique: "var(--alert)",
};

interface NewsFeedPageProps {
  onOpenAnnouncement?: (id: string) => void;
  onOpenCalendar?: () => void;
}

// Fil d'actualités : chronologie agrégée « quoi de neuf » (annonces + événements)
// qui me concernent. Lecture seule ; chaque élément ouvre sa source.
export function NewsFeedPage({ onOpenAnnouncement, onOpenCalendar }: NewsFeedPageProps) {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const [items, setItems] = useState<NewsfeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getNewsfeed()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" }) : "—";
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  function open(item: NewsfeedItem) {
    if (item.kind === "announcement") onOpenAnnouncement?.(item.id);
    else onOpenCalendar?.();
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("news.title", "Fil d'actualités")}</h1>
      <p className="ecl-page__lead">{t("news.lead", "Le « quoi de neuf » de la maison : annonces et événements qui vous concernent.")}</p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 }}>{error}</div>}

      {items.length === 0 && !error ? (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>{t("news.empty", "Rien de neuf pour l'instant.")}</p>
      ) : (
        <div style={{ marginTop: 14, borderLeft: "2px solid var(--line)", paddingLeft: 0 }}>
          {items.map((item) => {
            const isAnn = item.kind === "announcement";
            const color = isAnn ? PRIORITY_COLORS[item.priority ?? "normale"] : "var(--eclosion-dark)";
            return (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => open(item)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: "10px 12px 10px 16px", position: "relative", borderBottom: "1px solid var(--line)" }}
              >
                {/* Pastille de la timeline */}
                <span style={{ position: "absolute", left: -7, top: 16, width: 10, height: 10, borderRadius: 999, background: color, border: "2px solid var(--card)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15 }}>{isAnn ? "📣" : item.event_type === "echeance" ? "⏰" : "📅"}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color }}>
                    {isAnn ? t("news.kind_announcement", "Annonce") : t("news.kind_event", "Événement")}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                    {fmt(item.date)}
                    {item.kind === "event" && !item.all_day && item.date ? ` · ${fmtTime(item.date)}` : ""}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginTop: 3 }}>{item.title}</div>
                {item.preview && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{item.preview}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
