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

  // Répartition par étape : on montre TOUTES les étapes (y compris à 0) pour un
  // suivi complet, regroupées par grande phase du circuit. « Acceptés & en
  // production » n'est plus une boîte fourre-tout : on voit où sont les ouvrages.
  const maxCount = Math.max(1, ...data.by_status.map((s) => s.count));
  const PHASES: { label: string; min: number; max: number }[] = [
    { label: "Éditorial (réception → réécriture)", min: 1, max: 8 },
    { label: "Fabrication (mise en page → stock)", min: 9, max: 16 },
    { label: "Diffusion (commercialisation → archivage)", min: 17, max: 20 },
  ];
  const phases = PHASES.map((p) => {
    const steps = data.by_status.filter((s) => s.step_order >= p.min && s.step_order <= p.max).sort((a, b) => a.step_order - b.step_order);
    return { ...p, steps, subtotal: steps.reduce((n, s) => n + s.count, 0) };
  }).filter((p) => p.steps.length > 0);

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

      {/* Répartition par étape — TOUTES les étapes (0 compris), par phase, pour
          que la direction voie exactement où sont les ouvrages en production. */}
      {phases.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--eclosion-dark, #8A6A12)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
            Répartition par étape (les 20 étapes)
          </div>
          {phases.map((p) => (
            <div key={p.label} style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{p.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>sous-total <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{p.subtotal}</strong></span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {p.steps.map((s) => (
                  <div key={s.code} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, opacity: s.count > 0 ? 1 : 0.5 }}>
                    <span style={{ minWidth: 190, color: "var(--ink)" }}>{s.step_order}. {s.label}</span>
                    <span style={{ flex: 1, height: 10, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${Math.round((s.count / maxCount) * 100)}%`, background: "linear-gradient(90deg, var(--eclosion-dark, #a87d14), var(--eclosion, #C89A1B))" }} />
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", color: s.count > 0 ? "var(--ink)" : "var(--muted)", minWidth: 28, textAlign: "right", fontWeight: s.count > 0 ? 700 : 400 }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
