import { useEffect, useState } from "react";

// Tableau de bord du sous-module « Manuscrits » (refonte du pôle éditorial).
// Indicateurs de flux en tête de la page Manuscrits. Fetch autonome, réservé
// côté serveur à l'éditorial/direction : se masque de lui-même sinon. Additif.

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

interface Data {
  recus: number;
  en_evaluation: number;
  en_attente: number;
  acceptes: number;
  refuses: number;
  taux_acceptation: number | null;
  delai_moyen_traitement_jours: number | null;
  en_retard: number;
  by_status: { code: string; label: string; step_order: number; count: number }[];
}

export function ManuscriptsDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/editorial/manuscripts/dashboard`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed || !data) return null;

  const tiles: { label: string; value: string; tone?: "warn" }[] = [
    { label: "Reçus", value: String(data.recus) },
    { label: "En évaluation", value: String(data.en_evaluation) },
    { label: "En attente de décision", value: String(data.en_attente) },
    { label: "Taux d'acceptation", value: data.taux_acceptation != null ? `${Math.round(data.taux_acceptation * 100)} %` : "—" },
    { label: "Délai moyen de traitement", value: data.delai_moyen_traitement_jours != null ? `${data.delai_moyen_traitement_jours} j` : "—" },
    { label: "Dossiers en retard", value: String(data.en_retard), tone: data.en_retard > 0 ? "warn" : undefined },
  ];

  const withCount = data.by_status.filter((s) => s.count > 0);
  const maxCount = Math.max(1, ...withCount.map((s) => s.count));

  return (
    <section className="ecl-card" style={{ marginTop: 4, marginBottom: 8 }}>
      <h2 style={{ fontFamily: "var(--font-title)", fontSize: 15, margin: "0 0 12px" }}>Tableau de bord — Manuscrits</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {tiles.map((t) => {
          const color = t.tone === "warn" ? "var(--amber, #C4661F)" : "var(--ink)";
          const bg = t.tone === "warn" ? "var(--amber-soft, #F6E7D2)" : "var(--eclosion-soft)";
          return (
            <div key={t.label} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", background: bg }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 700, color, lineHeight: 1.1 }}>{t.value}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{t.label}</div>
            </div>
          );
        })}
      </div>

      {/* Répartition par étape (où sont les manuscrits). */}
      {withCount.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--eclosion-dark, #8A6A12)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            Répartition par étape
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {withCount.map((s) => (
              <div key={s.code} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ minWidth: 190, color: "var(--ink)" }}>{s.label}</span>
                <span style={{ flex: 1, height: 10, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.round((s.count / maxCount) * 100)}%`, background: "linear-gradient(90deg, var(--eclosion-dark, #a87d14), var(--eclosion, #C89A1B))" }} />
                </span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", minWidth: 28, textAlign: "right" }}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
