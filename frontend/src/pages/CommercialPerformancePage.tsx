import { useEffect, useMemo, useState } from "react";
import { TableScroll } from "../components/TableScroll";
import { getMyPerformance, getSalesTargets, setSalesTarget, type MyPerformance, type SalesTargetRow } from "../api/client";
import { GuidanceNote } from "../components/GuidanceNote";

// « Mes performances » — tableau de bord INDIVIDUEL du commercial connecté.
// Strictement personnel ; les responsables peuvent consolider l'équipe.

type Preset = "today" | "week" | "month" | "quarter" | "year" | "all" | "custom";
const PRESETS: { key: Preset; label: string; days: number | null }[] = [
  { key: "today", label: "Jour", days: 0 },
  { key: "week", label: "Semaine", days: 7 },
  { key: "month", label: "Mois", days: 30 },
  { key: "quarter", label: "Trimestre", days: 90 },
  { key: "year", label: "Année", days: 365 },
  { key: "all", label: "Tout", days: null },
];

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}

export function CommercialPerformancePage({ canManage }: { canManage: boolean }) {
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [consolidated, setConsolidated] = useState(false);
  const [data, setData] = useState<MyPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === "all") return {};
    if (preset === "custom") return { from: customFrom || undefined, to: customTo || undefined };
    const days = PRESETS.find((p) => p.key === preset)?.days ?? 30;
    const from = new Date();
    if (days === 0) from.setHours(0, 0, 0, 0);
    else from.setTime(Date.now() - days * 864e5);
    return { from: from.toISOString() };
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    getMyPerformance({ ...range, rep: consolidated ? "all" : undefined })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, [range, consolidated]);

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">Mes performances</h1>
      <p className="ecl-page__lead">Vos résultats commerciaux personnels — ventes, chiffre d'affaires, commandes et meilleurs clients.</p>

      <GuidanceNote title="Tableau de bord personnel">
        Ce tableau n'affiche que <strong>vos propres opérations</strong> (les ventes et commandes que vous avez initiées).
        {canManage && " En tant que responsable, vous pouvez consolider l'ensemble de l'équipe."}
      </GuidanceNote>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, margin: "12px 0" }}>{error}</div>}

      {/* Filtres de période */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "14px 0" }}>
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => setPreset(p.key)} style={chip(preset === p.key)}>{p.label}</button>
        ))}
        <button onClick={() => setPreset("custom")} style={chip(preset === "custom")}>Période personnalisée</button>
        {preset === "custom" && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={dateInput} />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={dateInput} />
          </>
        )}
        {canManage && data?.can_see_others && (
          <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={consolidated} onChange={(e) => setConsolidated(e.target.checked)} />
            Équipe (consolidé)
          </label>
        )}
      </div>

      {!data ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Chargement…</p>
      ) : (
        <>
          {consolidated && <div style={{ fontSize: 12.5, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 600, marginBottom: 8 }}>Vue consolidée — ensemble de l'équipe commerciale.</div>}

          {/* Objectif annuel + taux de réalisation */}
          {data.objective && (
            <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 13.5 }}>
                <span style={{ fontWeight: 600 }}>Objectif {data.objective.year}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {fcfa(data.objective.ytd_revenue)} / {fcfa(data.objective.target_revenue)} · <strong style={{ color: data.objective.realization_pct >= 100 ? "#2E6B4F" : "var(--eclosion-dark, #9a7a12)" }}>{data.objective.realization_pct} %</strong>
                </span>
              </div>
              <div style={{ height: 10, background: "var(--paper)", borderRadius: 999, overflow: "hidden", marginTop: 8, border: "1px solid var(--line)" }}>
                <div style={{ width: `${Math.min(100, data.objective.realization_pct)}%`, height: "100%", background: data.objective.realization_pct >= 100 ? "#2E6B4F" : "var(--eclosion)", borderRadius: 999 }} />
              </div>
            </div>
          )}

          {/* Cartes KPI */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Kpi label="Chiffre d'affaires" value={fcfa(data.revenue)} tone="gold" />
            <Kpi label="Ventes réalisées" value={String(data.sales_count)} />
            <Kpi label="Commandes" value={String(data.orders_count)} />
            <Kpi label="Taux de transformation" value={`${data.transformation_rate} %`} />
            <Kpi label="Montant moyen / vente" value={fcfa(data.avg_sale)} />
            <Kpi label="Nouveaux clients" value={String(data.new_customers)} />
            <Kpi label="Clients actifs" value={String(data.active_customers)} />
            <Kpi label="Commandes en attente" value={String(data.orders_pending)} />
            <Kpi label="Commandes livrées" value={String(data.orders_delivered)} tone="green" />
            <Kpi label="Commandes annulées" value={String(data.orders_cancelled)} tone={data.orders_cancelled > 0 ? "red" : undefined} />
          </div>

          {/* Paiements */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 12 }}>
            <Kpi label="Paiements reçus" value={fcfa(data.payments.received)} tone="green" />
            <Kpi label="En attente de paiement" value={fcfa(data.payments.pending)} tone={data.payments.pending > 0 ? "gold" : undefined} />
            <Kpi label="Impayés (échus)" value={fcfa(data.payments.overdue)} tone={data.payments.overdue > 0 ? "red" : undefined} />
            <Kpi label="Factures non réglées" value={String(data.payments.unpaid_count)} />
          </div>

          {/* Ventes par horizon */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 12 }}>
            <Kpi label="Ventes du jour" value={fcfa(data.by_period.today)} small />
            <Kpi label="7 derniers jours" value={fcfa(data.by_period.week)} small />
            <Kpi label="30 derniers jours" value={fcfa(data.by_period.month)} small />
            <Kpi label="12 derniers mois" value={fcfa(data.by_period.year)} small />
          </div>

          {/* Évolution des ventes (graphique) */}
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Évolution des ventes (par mois)</div>
            <SalesChart series={data.series} />
          </div>

          {/* Classements */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 20 }}>
            <RankTable title="Meilleurs clients (CA)" rows={data.top_customers.map((c) => [c.name, fcfa(c.revenue)])} empty="Aucune vente sur la période." />
            <RankTable title="Livres les plus vendus" rows={data.top_books.map((b) => [b.title, `${b.units} ex.`])} empty="Aucune vente sur la période." />
          </div>

          {canManage && <TeamTargets onError={setError} />}
        </>
      )}
    </div>
  );
}

// Gestion des objectifs annuels de l'équipe (responsables). Liste et modifie les
// objectifs de l'année en cours.
function TeamTargets({ onError }: { onError: (m: string) => void }) {
  const year = new Date().getFullYear();
  const [targets, setTargets] = useState<SalesTargetRow[]>([]);
  const [candidates, setCandidates] = useState<{ id: string; username: string }[]>([]);
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => getSalesTargets(year).then((r) => { setTargets(r.targets); setCandidates(r.candidates); }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function save() {
    if (!userId || !amount) return;
    setSaving(true);
    try {
      await setSalesTarget({ user_id: userId, year, target_revenue: Number(amount) });
      setUserId(""); setAmount("");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Objectifs de l'équipe — {year}</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px" }}>Définissez l'objectif annuel de chiffre d'affaires par commercial.</p>
      {targets.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {targets.map((tg) => (
            <div key={tg.user_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
              <span>{tg.username}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fcfa(tg.target_revenue)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} style={dateInput}>
          <option value="">— Commercial —</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
        </select>
        <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Objectif annuel (FCFA)" style={{ ...dateInput, fontFamily: "var(--font-mono)" }} />
        <button onClick={save} disabled={saving || !userId || !amount} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer", opacity: saving || !userId || !amount ? 0.6 : 1 }}>
          {saving ? "…" : "Définir l'objectif"}
        </button>
      </div>
    </div>
  );
}

// Graphique d'évolution du CA par mois — barres SVG légères (sans dépendance),
// libellés de mois abrégés, valeur au survol.
function SalesChart({ series }: { series: { month: string; revenue: number }[] }) {
  if (series.length === 0) return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune vente sur la période sélectionnée.</p>;
  const max = Math.max(...series.map((s) => s.revenue), 1);
  const W = Math.max(series.length * 56, 220);
  const H = 160;
  const pad = { top: 12, bottom: 26, left: 6, right: 6 };
  const chartH = H - pad.top - pad.bottom;
  const bw = (W - pad.left - pad.right) / series.length;
  const monthLabel = (m: string) => {
    const [y, mo] = m.split("-");
    return `${["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"][Number(mo) - 1] ?? mo} ${y.slice(2)}`;
  };
  const fmt = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
  return (
    <TableScroll>
      <svg width={W} height={H} role="img" aria-label="Évolution du chiffre d'affaires par mois" style={{ maxWidth: "100%" }}>
        {series.map((s, i) => {
          const h = Math.round((s.revenue / max) * chartH);
          const x = pad.left + i * bw + bw * 0.18;
          const y = pad.top + (chartH - h);
          return (
            <g key={s.month}>
              <rect x={x} y={y} width={bw * 0.64} height={h} rx={3} fill="var(--eclosion, #d9b21a)">
                <title>{`${monthLabel(s.month)} : ${fmt(s.revenue)}`}</title>
              </rect>
              <text x={pad.left + i * bw + bw / 2} y={H - 9} textAnchor="middle" fontSize="10" fill="var(--muted, #5A6478)">{monthLabel(s.month)}</text>
            </g>
          );
        })}
      </svg>
    </TableScroll>
  );
}

function Kpi({ label, value, tone, small }: { label: string; value: string; tone?: "gold" | "green" | "red"; small?: boolean }) {
  const color = tone === "gold" ? "var(--eclosion-dark, #9a7a12)" : tone === "green" ? "#2E6B4F" : tone === "red" ? "var(--alert)" : "var(--ink)";
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: small ? "10px 12px" : "14px 16px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: small ? 16 : 22, fontWeight: 700, color, fontFamily: "var(--font-mono, monospace)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

function RankTable({ title, rows, empty }: { title: string; rows: [string, string][]; empty: string }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--line)" }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>{empty}</div>
      ) : (
        <div>
          {rows.map(([name, val], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 14px", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 13.5 }}>
              <span style={{ color: "var(--muted)", minWidth: 22 }}>{i + 1}.</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const chip = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? "var(--eclosion)" : "var(--line)"}`,
  background: active ? "var(--eclosion-soft)" : "var(--card, #fff)",
  color: "var(--ink)", borderRadius: 999, padding: "6px 13px", fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer",
});
const dateInput: React.CSSProperties = { padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 };
