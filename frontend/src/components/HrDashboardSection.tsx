import { useEffect, useState } from "react";
import { getHrDashboard, type HrDashboard } from "../api/client";
import { Card } from "./Card";
import { IconAdmin } from "./icons";

// Tableau de bord RH (remplace l'ancien tableau de présence, retiré le 13/08/2026).
// Indicateurs de pilotage RH : effectif & répartition, contrats à échéance,
// congés, recrutement & formation. Aucune donnée de présence/pointage.

const CONTRACT_LABELS: Record<string, string> = { cdi: "CDI", cdd: "CDD", stage: "Stage", prestation: "Prestation", sans_contrat: "Sans contrat" };
const STATUS_LABELS: Record<string, string> = { salarie: "Salariés", prestataire_externe: "Prestataires externes", stagiaire: "Stagiaires", benevole: "Bénévoles" };

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)" };
const num = (n: number) => n.toLocaleString("fr-FR");
const dateFr = (s: string) => new Date(s).toLocaleDateString("fr-FR");

function Tile({ label, value, tone }: { label: string; value: string; tone?: "gold" | "alert" | "ink" }) {
  const color = tone === "gold" ? "var(--eclosion, #d9b21a)" : tone === "alert" ? "var(--alert, #C4661F)" : "var(--ink)";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", minWidth: 130, flex: "1 1 130px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ ...mono, fontSize: 26, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Bars({ rows, labels }: { rows: { key: string; count: number }[]; labels?: Record<string, string> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <div style={{ width: 150, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labels?.[r.key] ?? r.key}</div>
          <div style={{ flex: 1, background: "var(--eclosion-soft, #f3efdc)", borderRadius: 6, height: 16, position: "relative", minWidth: 60 }}>
            <div style={{ width: `${(r.count / max) * 100}%`, background: "var(--eclosion, #d9b21a)", height: "100%", borderRadius: 6 }} />
          </div>
          <div style={{ ...mono, width: 34, textAlign: "right", fontWeight: 700 }}>{r.count}</div>
        </div>
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

export function HrDashboardSection({ collapsible, defaultOpen }: { collapsible?: boolean; defaultOpen?: boolean }) {
  const [data, setData] = useState<HrDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHrDashboard().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  return (
    <Card title="Tableau de bord RH" icon={<IconAdmin />} subtitle="Effectif, contrats, congés, recrutement & formation." collapsible={collapsible} defaultOpen={defaultOpen}>
      {error && <div style={{ fontSize: 13, color: "var(--alert, #C4661F)" }}>{error}</div>}
      {!data && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</div>}
      {data && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Tile label="Effectif actif" value={num(data.effectif.total)} tone="ink" />
            <Tile label="Solde congés (jours)" value={num(data.leaves.balance_total_days)} tone="gold" />
            <Tile label="Congés en attente" value={num(data.leaves.pending_count)} tone={data.leaves.pending_count > 0 ? "alert" : "ink"} />
            <Tile label="Contrats à échéance (60 j)" value={num(data.contracts.ending_soon.length)} tone={data.contracts.ending_soon.length > 0 ? "alert" : "ink"} />
            <Tile label="Postes ouverts" value={num(data.recruitment_training.open_positions)} tone="ink" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
            <Block title="Répartition par département">
              <Bars rows={data.effectif.by_department.map((d) => ({ key: d.name, count: d.count }))} />
            </Block>
            <Block title="Répartition par contrat">
              <Bars rows={data.effectif.by_contract_type.map((c) => ({ key: c.type, count: c.count }))} labels={CONTRACT_LABELS} />
            </Block>
          </div>

          <Block title="Contrats arrivant à échéance (60 jours)">
            {data.contracts.ending_soon.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucun contrat à échéance dans les 60 jours.</div>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {data.contracts.ending_soon.map((c, i) => (
                  <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 13, borderTop: i ? "1px solid var(--line)" : undefined, paddingTop: i ? 4 : 0 }}>
                    <span style={{ fontWeight: 600 }}>{c.employee}</span>
                    <span style={{ fontSize: 11.5, borderRadius: 999, padding: "1px 8px", background: "var(--eclosion-soft, #f3efdc)", color: "var(--eclosion-dark, #9a7a12)" }}>{CONTRACT_LABELS[c.type] ?? c.type}</span>
                    {c.position && <span style={{ color: "var(--muted)" }}>· {c.position}</span>}
                    <span style={{ marginLeft: "auto", ...mono }}>fin le {dateFr(c.end_date)}</span>
                    {c.days_left != null && <span style={{ ...mono, color: c.days_left <= 15 ? "var(--alert, #C4661F)" : "var(--muted)", fontWeight: 700 }}>J-{c.days_left}</span>}
                  </div>
                ))}
              </div>
            )}
          </Block>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
            <Block title="Congés">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <Tile label="En cours" value={num(data.leaves.ongoing_count)} tone="ink" />
                <Tile label="À venir (30 j)" value={num(data.leaves.upcoming_count)} tone="ink" />
              </div>
              {data.leaves.pending.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucune demande de congé en attente.</div>
              ) : (
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Demandes en attente :</div>
                  {data.leaves.pending.map((l, i) => (
                    <div key={i} style={{ fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{l.employee}</span>
                      <span style={{ ...mono, color: "var(--muted)" }}>du {dateFr(l.from)} au {dateFr(l.to)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Block>
            <Block title="Recrutement & formation">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Tile label="Postes ouverts" value={num(data.recruitment_training.open_positions)} tone="ink" />
                <Tile label="Candidatures en cours" value={num(data.recruitment_training.applications_active)} tone="ink" />
                <Tile label="Formations planifiées" value={num(data.recruitment_training.trainings_planned)} tone="ink" />
                <Tile label="Demandes de formation" value={num(data.recruitment_training.training_requests_pending)} tone={data.recruitment_training.training_requests_pending > 0 ? "alert" : "ink"} />
              </div>
            </Block>
          </div>
        </>
      )}
    </Card>
  );
}
