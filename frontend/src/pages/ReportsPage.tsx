import { useEffect, useState } from "react";
import {
  createAnalysis,
  listAnalyses,
  listKpis,
  listReports,
  promoteAnalysis,
  runAnalysis,
  runReport,
  simulatePrintRun,
  type KpiDefinition,
  type Report,
  type ReportDomain,
  type SavedAnalysis,
} from "../api/client";
import { DataTable } from "../components/DataTable";
import { Card } from "../components/Card";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconPilotage } from "../components/icons";

const DOMAIN_LABELS: Record<ReportDomain, string> = {
  editorial: "Éditorial",
  production: "Production",
  commercial: "Commercial",
  financier: "Financier",
  rh: "Ressources humaines",
};

interface ReportsPageProps {
  canCreateAnalysis: boolean;
  canPromoteAnalysis: boolean;
}

interface SimulationResult {
  daily_sale_rate: number;
  simulations: { quantity: number; unit_cost: number | null; estimated_days_to_sell_out: number | null }[];
}

// Ch. 20 : rapports standards, dictionnaire d'indicateurs, explorateur
// d'analyses personnelles, simulation de tirage.
export function ReportsPage({ canCreateAnalysis, canPromoteAnalysis }: ReportsPageProps) {
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [reportRows, setReportRows] = useState<{ reportId: string; rows: unknown[] } | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, { metric: string; value: unknown }>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Fenêtres intégrées (remplacent les pop-up du navigateur).
  const [createForm, setCreateForm] = useState<{ label: string; metric: string } | null>(null);
  const [promoteFor, setPromoteFor] = useState<SavedAnalysis | null>(null);
  const [promoteForm, setPromoteForm] = useState<{ key: string; domain: ReportDomain }>({ key: "", domain: "editorial" });
  const [simForm, setSimForm] = useState<{ manuscriptId: string; quantities: string } | null>(null);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  const refresh = async () => {
    const [kpiList, reportList, analysisList] = await Promise.all([listKpis(), listReports(), listAnalyses()]);
    setKpis(kpiList);
    setReports(reportList);
    setAnalyses(analysisList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function handleRunReport(report: Report) {
    try {
      const result = await runReport(report.id);
      setReportRows({ reportId: report.id, rows: result.rows });
      setMessage(`${result.rows.length} ligne(s) générée(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la génération du rapport.");
    }
  }

  async function submitCreateAnalysis() {
    if (!createForm || !createForm.label.trim() || !createForm.metric) return;
    try {
      await createAnalysis({ label: createForm.label.trim(), definition: { metric: createForm.metric } });
      setMessage("Analyse enregistrée.");
      setCreateForm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement de l'analyse.");
    }
  }

  async function handleRunAnalysis(analysis: SavedAnalysis) {
    try {
      const result = await runAnalysis(analysis.id);
      setAnalysisResults((prev) => ({ ...prev, [analysis.id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du calcul.");
    }
  }

  async function submitPromote() {
    if (!promoteFor || !promoteForm.key.trim()) return;
    try {
      await promoteAnalysis(promoteFor.id, promoteForm.key.trim(), promoteForm.domain);
      setMessage("Analyse promue en rapport standard.");
      setPromoteFor(null);
      setPromoteForm({ key: "", domain: "editorial" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la promotion.");
    }
  }

  async function submitSimulation() {
    if (!simForm || !simForm.manuscriptId.trim()) return;
    const quantities = simForm.quantities.split(",").map((q) => Number(q.trim())).filter((q) => q > 0);
    if (quantities.length === 0) return;
    try {
      const result = await simulatePrintRun(simForm.manuscriptId.trim(), quantities);
      setSimResult(result as SimulationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la simulation.");
    }
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">Rapports et indicateurs</h1>
      <p className="ecl-page__lead">Rapports standards, indicateurs de pilotage, analyses personnelles et simulations.</p>

      {error && (
        <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>
      )}
      {message && (
        <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>
      )}

      {/* Ch. 20 §20.2 — Dictionnaire d'indicateurs */}
      <Card
        title="Dictionnaire d'indicateurs"
        icon={<IconPilotage />}
        subtitle="Ce que mesure chaque indicateur de pilotage."
      >
        {kpis.length === 0 ? (
          <Empty>Aucun indicateur.</Empty>
        ) : (
          <div className="ecl-list">
            {kpis.map((kpi) => (
              <div key={kpi.code} className="ecl-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="ecl-row__main">
                  <div className="ecl-row__title">{kpi.label}</div>
                  {/* Le jargon (code technique + formule) est replié : l'écran
                      métier reste lisible, le détail reste accessible d'un clic. */}
                  <details className="ecl-tech">
                    <summary>Détail technique</summary>
                    <div className="ecl-tech__body">
                      {kpi.code}
                      {"\n"}
                      {kpi.formula}
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 20 §20.3 — Bibliothèque de rapports standards */}
      <Card title="Bibliothèque de rapports standards" icon={<IconPilotage />} subtitle="Rapports prêts à générer, par domaine.">
        {reports.length === 0 ? (
          <Empty>Aucun rapport catalogué.</Empty>
        ) : (
          <div className="ecl-list">
            {reports.map((report) => (
              <div key={report.id}>
                <div className="ecl-row">
                  <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="ecl-row__title">{report.label}</span>
                    <DomainChip domain={report.domain} />
                  </div>
                  <Button variant="view" size="sm" onClick={() => handleRunReport(report)}>
                    Générer
                  </Button>
                </div>
                {reportRows?.reportId === report.id && (
                  <div style={{ marginTop: 8 }}>
                    <DataTable rows={reportRows.rows as Record<string, unknown>[]} emptyLabel="Aucune donnée pour ce rapport." />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 20 §20.4 — Explorateur d'analyses personnelles */}
      <Card
        title="Explorateur d'analyses personnelles"
        icon={<IconPilotage />}
        subtitle="Vos analyses sur mesure à partir des indicateurs."
        action={
          canCreateAnalysis ? (
            <Button variant="add" size="sm" onClick={() => setCreateForm({ label: "", metric: kpis[0]?.code ?? "" })}>
              + Analyse
            </Button>
          ) : undefined
        }
      >
        {analyses.length === 0 ? (
          <Empty>Aucune analyse enregistrée.</Empty>
        ) : (
          <div className="ecl-list">
            {analyses.map((analysis) => (
              <div key={analysis.id} className="ecl-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div className="ecl-row__main">
                    <div className="ecl-row__title">{analysis.label}</div>
                    <div className="ecl-row__desc" style={{ fontFamily: "var(--font-mono)" }}>{analysis.definition.metric}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Button variant="view" size="sm" onClick={() => handleRunAnalysis(analysis)}>
                      Calculer
                    </Button>
                    {canPromoteAnalysis && (
                      <Button variant="edit" size="sm" onClick={() => setPromoteFor(analysis)}>
                        Promouvoir
                      </Button>
                    )}
                  </div>
                </div>
                {analysisResults[analysis.id] && <AnalysisResult value={analysisResults[analysis.id].value} />}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 20 §20.6 — Simulation de tirage */}
      <Card
        title="Simulation de tirage"
        icon={<IconPilotage />}
        subtitle="Estimez le coût unitaire et l'écoulement selon la quantité imprimée."
        action={
          <Button variant="add" size="sm" onClick={() => { setSimForm({ manuscriptId: "", quantities: "1000,2000,3000" }); setSimResult(null); }}>
            Simuler
          </Button>
        }
      >
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Lancez une simulation pour comparer plusieurs quantités de tirage d'un ouvrage.
        </p>
      </Card>

      {/* ── Fenêtres intégrées ─────────────────────────────────────────────── */}
      {createForm && (
        <Modal
          title="Nouvelle analyse"
          onClose={() => setCreateForm(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setCreateForm(null)}>Annuler</Button>
              <Button variant="add" size="sm" onClick={submitCreateAnalysis} disabled={!createForm.label.trim() || !createForm.metric}>
                Enregistrer
              </Button>
            </>
          }
        >
          <Field label="Libellé de l'analyse">
            <input
              value={createForm.label}
              onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })}
              placeholder="Ex. Chiffre d'affaires du trimestre"
              autoFocus
            />
          </Field>
          <Field label="Indicateur mesuré">
            <select value={createForm.metric} onChange={(e) => setCreateForm({ ...createForm, metric: e.target.value })}>
              {kpis.map((k) => (
                <option key={k.code} value={k.code}>{k.label}</option>
              ))}
            </select>
          </Field>
        </Modal>
      )}

      {promoteFor && (
        <Modal
          title="Promouvoir en rapport standard"
          onClose={() => setPromoteFor(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setPromoteFor(null)}>Annuler</Button>
              <Button variant="edit" size="sm" onClick={submitPromote} disabled={!promoteForm.key.trim()}>
                Promouvoir
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Analyse : <strong style={{ color: "var(--ink)" }}>{promoteFor.label}</strong>
          </p>
          <Field label="Clé du rapport">
            <input
              value={promoteForm.key}
              onChange={(e) => setPromoteForm({ ...promoteForm, key: e.target.value })}
              placeholder="Ex. ca_trimestriel"
              autoFocus
            />
          </Field>
          <Field label="Domaine">
            <select value={promoteForm.domain} onChange={(e) => setPromoteForm({ ...promoteForm, domain: e.target.value as ReportDomain })}>
              {Object.entries(DOMAIN_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
        </Modal>
      )}

      {simForm && (
        <Modal
          title="Simulation de tirage"
          onClose={() => { setSimForm(null); setSimResult(null); }}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => { setSimForm(null); setSimResult(null); }}>Fermer</Button>
              <Button variant="add" size="sm" onClick={submitSimulation} disabled={!simForm.manuscriptId.trim()}>
                Lancer la simulation
              </Button>
            </>
          }
        >
          <Field label="Identifiant du manuscrit">
            <input
              value={simForm.manuscriptId}
              onChange={(e) => setSimForm({ ...simForm, manuscriptId: e.target.value })}
              placeholder="Coller l'identifiant de l'ouvrage"
              autoFocus
            />
          </Field>
          <Field label="Quantités à comparer (séparées par des virgules)">
            <input
              value={simForm.quantities}
              onChange={(e) => setSimForm({ ...simForm, quantities: e.target.value })}
              placeholder="1000, 2000, 3000"
            />
          </Field>
          {simResult && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
                Rythme de vente quotidien estimé : <strong style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{simResult.daily_sale_rate}</strong>
              </div>
              <DataTable
                rows={simResult.simulations.map((s) => ({
                  Quantité: s.quantity,
                  "Coût unitaire": s.unit_cost ?? "—",
                  "Écoulement (jours)": s.estimated_days_to_sell_out ?? "—",
                }))}
                emptyLabel="Aucune simulation."
              />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// Résultat d'un indicateur calculé : soit un nombre unique (en chasse fixe),
// soit une répartition (tableau).
function AnalysisResult({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return <DataTable rows={value as Record<string, unknown>[]} emptyLabel="Aucune donnée." />;
  }
  const display =
    typeof value === "number"
      ? value.toLocaleString("fr-FR")
      : value === null || value === undefined
        ? "—"
        : String(value);
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: "var(--eclosion)" }}>{display}</div>
  );
}

function DomainChip({ domain }: { domain: ReportDomain }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--eclosion-dark)",
        background: "var(--eclosion-soft)",
        borderRadius: 999,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {DOMAIN_LABELS[domain]}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{children}</p>;
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
