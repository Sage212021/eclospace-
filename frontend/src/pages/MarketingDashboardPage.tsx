import { useEffect, useState } from "react";
import { getMarketingDashboard, type MarketingDashboard, type MarketingCanal } from "../api/client";

// Pôle Marketing, Communication & Distribution — Tableau de bord.
const CANAL: Record<MarketingCanal, string> = {
  reseaux_sociaux: "Réseaux sociaux", presse: "Presse", newsletter: "Newsletter", lancement: "Lancement",
  dedicace: "Dédicace", salon: "Salon", partenariat: "Partenariat", influenceur: "Influenceur",
  institutionnel: "Institutionnel", vente_directe: "Vente directe", autre: "Autre",
};
const fcfa = (n: number) => `${Number(n).toLocaleString("fr-FR")} FCFA`;
const dfr = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

export function MarketingDashboardPage() {
  const [d, setD] = useState<MarketingDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getMarketingDashboard().then(setD).catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible.")); }, []);

  if (err) return <div className="ecl-page"><div style={alertBox}>{err}</div></div>;
  if (!d) return <div className="ecl-page"><p style={{ color: "var(--muted)" }}>Chargement…</p></div>;

  const tiles: { icon: string; value: string | number; label: string }[] = [
    { icon: "📚", value: d.kpis.catalogue, label: "Ouvrages au catalogue" },
    { icon: "🟢", value: d.kpis.campaigns_active, label: "Campagnes actives" },
    { icon: "📢", value: d.kpis.actions_week, label: "Actions cette semaine" },
    { icon: "🏪", value: d.kpis.partners_active, label: "Partenaires actifs" },
    { icon: "🎯", value: d.kpis.launches_upcoming, label: "Lancements à venir" },
    { icon: "💰", value: fcfa(d.kpis.budget_engage), label: "Budget engagé" },
  ];

  return (
    <div className="ecl-page" style={{ maxWidth: 1040 }}>
      <h1 className="ecl-page__title">Tableau de bord — Marketing</h1>
      <p className="ecl-page__lead">Vue d'ensemble de la mise en marché : catalogue, campagnes, actions et réseau de diffusion.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 12 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 20 }}>{t.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--ink)", marginTop: 4 }}>{t.value}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* À faire / alertes. */}
      {(d.alerts.actions_late > 0 || d.alerts.books_without_plan > 0) && (
        <section className="ecl-card" style={{ marginTop: 16 }}>
          <h2 style={h2}>⚠️ À surveiller</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.9 }}>
            {d.alerts.actions_late > 0 && <li><b style={{ color: "var(--alert, #B23A2E)" }}>{d.alerts.actions_late}</b> action(s) en retard (échéance passée, non terminées).</li>}
            {d.alerts.books_without_plan > 0 && <li><b style={{ color: "var(--amber, #B87400)" }}>{d.alerts.books_without_plan}</b> ouvrage(s) publié(s) sans fiche marketing.</li>}
          </ul>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        {/* Prochaines actions. */}
        <section className="ecl-card">
          <h2 style={h2}>📅 Prochaines actions</h2>
          {d.upcoming_actions.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune action à venir planifiée.</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {d.upcoming_actions.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
                  <span><b>{a.action}</b> <span style={{ color: "var(--muted)" }}>· {CANAL[a.canal]}{a.book ? ` · ${a.book.title}` : ""}</span></span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--eclosion-dark, #9a7a12)", whiteSpace: "nowrap" }}>{dfr(a.echeance)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Campagnes actives. */}
        <section className="ecl-card">
          <h2 style={h2}>🟢 Campagnes actives</h2>
          {d.active_campaigns.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune campagne en cours.</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {d.active_campaigns.map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
                  <span><b>{c.name}</b>{c.book ? <span style={{ color: "var(--muted)" }}> · {c.book.title}</span> : null}</span>
                  <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>→ {dfr(c.end_date)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 14.5, margin: "0 0 10px", color: "var(--ink)" };
const alertBox: React.CSSProperties = { background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 8, padding: "9px 13px", fontSize: 13, margin: "8px 0" };
