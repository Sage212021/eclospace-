import { useEffect, useState } from "react";

// Tableau de bord éditorial (refonte workflow — Lot B) : vue de pilotage du
// pôle éditorial. Indicateurs (retard, bloqués, taux d'acceptation, temps
// moyen, contrats, fabrication, commercialisation) + listes des dossiers en
// retard / bloqués. Fetch autonome (réservé côté serveur au pôle éditorial).

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

interface EditorialDashboardData {
  total: number;
  actifs: number;
  by_status: { code: string; label: string; step_order: number; count: number }[];
  en_retard: number;
  en_retard_list: { id: string; title: string; reference: string; step_label: string; days_over: number }[];
  bloques: number;
  bloques_list: { id: string; title: string; reference: string; reason: string }[];
  taux_acceptation: number | null;
  decisions: { acceptes: number; refuses: number; en_cours: number };
  temps_moyen_jours: number | null;
  contrats_signes: number;
  en_fabrication: number;
  en_commercialisation: number;
}

export function EditorialDashboardSection() {
  const [data, setData] = useState<EditorialDashboardData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/dashboard/editorial`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed || !data) return null;

  const tiles: { label: string; value: string; tone?: "warn" | "alert" }[] = [
    { label: "Dossiers en retard", value: String(data.en_retard), tone: data.en_retard > 0 ? "warn" : undefined },
    { label: "Dossiers bloqués", value: String(data.bloques), tone: data.bloques > 0 ? "alert" : undefined },
    { label: "Taux d'acceptation", value: data.taux_acceptation != null ? `${Math.round(data.taux_acceptation * 100)} %` : "—" },
    { label: "Temps moyen (réception → parution)", value: data.temps_moyen_jours != null ? `${data.temps_moyen_jours} j` : "—" },
    { label: "Contrats signés", value: String(data.contrats_signes) },
    { label: "En fabrication", value: String(data.en_fabrication) },
    { label: "En commercialisation", value: String(data.en_commercialisation) },
  ];

  return (
    <section className="ecl-card" style={{ marginTop: 24 }}>
      <h2 style={{ fontFamily: "var(--font-title)", fontSize: 15, margin: "0 0 4px" }}>Tableau de bord éditorial</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px" }}>
        {data.actifs} ouvrage{data.actifs > 1 ? "s" : ""} en cours · {data.total} au total.
      </p>

      {/* Tuiles d'indicateurs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => {
          const color = tile.tone === "alert" ? "var(--alert)" : tile.tone === "warn" ? "var(--amber, #C4661F)" : "var(--ink)";
          const bg = tile.tone === "alert" ? "var(--alert-soft)" : tile.tone === "warn" ? "var(--amber-soft, #F6E7D2)" : "var(--eclosion-soft)";
          return (
            <div key={tile.label} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", background: bg }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 700, color, lineHeight: 1.1 }}>{tile.value}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{tile.label}</div>
            </div>
          );
        })}
      </div>

      {/* Dossiers en retard */}
      {data.en_retard_list.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--amber, #C4661F)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            ⏰ En retard
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.en_retard_list.map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", padding: "5px 0" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 11.5 }}>{d.reference}</span> {d.title}
                  <span style={{ color: "var(--muted)" }}> — {d.step_label}</span>
                </span>
                <span style={{ color: "var(--amber, #C4661F)", fontWeight: 700, whiteSpace: "nowrap" }}>+{d.days_over} j</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dossiers bloqués */}
      {data.bloques_list.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--alert)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            ⛔ Bloqués
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.bloques_list.map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", padding: "5px 0" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 11.5 }}>{d.reference}</span> {d.title}
                </span>
                <span style={{ color: "var(--alert)", whiteSpace: "nowrap" }}>{d.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
