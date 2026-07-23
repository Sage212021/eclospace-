import { useEffect, useMemo, useState } from "react";
import { listProductionTracking, type ProductionTrackingItem } from "../api/client";
import { Card } from "../components/Card";
import { ManuscriptProgress } from "../components/ManuscriptProgress";
import { useI18n } from "../i18n";

// Suivi de production : « où en est chaque livre ». Chacun (commercial,
// assistanat éditorial…) clique un ouvrage et voit sa position, avec des
// voyants — de quoi renseigner un auteur d'un coup d'œil.

const TOTAL_STEPS = 20;

export function ProductionTrackingPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<ProductionTrackingItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    listProductionTracking().then(setItems).catch(() => setItems([]));
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => `${m.title} ${m.author ?? ""} ${m.manuscriptNumber} ${m.statusLabel}`.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <Card
      title={t("track.title", "Suivi des ouvrages")}
      subtitle={t("track.subtitle", "Où en est chaque livre dans sa fabrication — d'un coup d'œil.")}
    >
      {!items ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("common.loading", "Chargement…")}</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("track.empty", "Aucun ouvrage en production pour le moment.")}</p>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("track.search", "Rechercher un titre, un auteur…")}
            style={{ width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid var(--line)", borderRadius: 10, marginBottom: 14 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((m) => {
              const isOpen = openId === m.id;
              const pct = Math.round(((m.stepOrder - 1) / (TOTAL_STEPS - 1)) * 100);
              return (
                <div key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
                  <button
                    onClick={() => setOpenId(isOpen ? null : m.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{m.title}</div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                        {m.author ?? "—"} · <span style={{ fontFamily: "var(--font-mono)" }}>{m.manuscriptNumber}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--eclosion-dark)",
                          background: "var(--eclosion-soft)",
                          border: "1px solid var(--eclosion)",
                          borderRadius: 999,
                          padding: "3px 11px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ● {m.statusLabel}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{pct}%</span>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "0 14px 14px" }}>
                      <ManuscriptProgress stepOrder={m.stepOrder} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
