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

// Ch. 20 : rapports standards, dictionnaire d'indicateurs, explorateur
// d'analyses personnelles, simulation de tirage.
export function ReportsPage({ canCreateAnalysis, canPromoteAnalysis }: ReportsPageProps) {
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [reportRows, setReportRows] = useState<{ reportId: string; rows: unknown[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  async function handleCreateAnalysis() {
    const label = window.prompt("Libellé de l'analyse");
    if (!label) return;
    const metric = window.prompt(`Indicateur (${kpis.map((k) => k.code).join(", ")})`);
    if (!metric) return;
    try {
      await createAnalysis({ label, definition: { metric } });
      setMessage("Analyse enregistrée.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement de l'analyse.");
    }
  }

  async function handleRunAnalysis(analysis: SavedAnalysis) {
    try {
      const result = await runAnalysis(analysis.id);
      window.alert(`${result.metric} = ${JSON.stringify(result.value)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du calcul.");
    }
  }

  async function handlePromote(analysis: SavedAnalysis) {
    const key = window.prompt("Clé du rapport à créer");
    if (!key) return;
    const domain = (window.prompt("Domaine (editorial, production, commercial, financier, rh)", "editorial") ?? "editorial") as ReportDomain;
    try {
      await promoteAnalysis(analysis.id, key, domain);
      setMessage("Analyse promue en rapport standard.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la promotion.");
    }
  }

  async function handleSimulation() {
    const manuscriptId = window.prompt("ID du manuscrit");
    if (!manuscriptId) return;
    const quantitiesStr = window.prompt("Quantités à simuler (séparées par des virgules)", "1000,2000,3000");
    if (!quantitiesStr) return;
    const quantities = quantitiesStr.split(",").map((q) => Number(q.trim())).filter((q) => q > 0);
    try {
      const result = await simulatePrintRun(manuscriptId, quantities);
      const lines = result.simulations
        .map((s) => `${s.quantity} : coût unitaire ${s.unit_cost ?? "—"}, écoulement estimé ${s.estimated_days_to_sell_out ?? "—"} j`)
        .join("\n");
      window.alert(`Rythme de vente quotidien : ${result.daily_sale_rate}\n\n${lines}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la simulation.");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Rapports et indicateurs</h1>
      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        {/* Ch. 20 §20.2 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Dictionnaire d'indicateurs</div>
        {kpis.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun indicateur.</p>}
        {kpis.map((kpi) => (
          <div key={kpi.code} style={{ borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{kpi.code}</strong> — {kpi.label}
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{kpi.formula}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        {/* Ch. 20 §20.3 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Bibliothèque de rapports standards</div>
        {reports.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun rapport catalogué.</p>}
        {reports.map((report) => (
          <div key={report.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
              <span>
                {report.label} — {DOMAIN_LABELS[report.domain]}
              </span>
              <button onClick={() => handleRunReport(report)} style={secondaryButtonStyle}>
                Générer
              </button>
            </div>
            {reportRows?.reportId === report.id && (
              <pre style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, whiteSpace: "pre-wrap", background: "var(--bg, #f7f7f7)", padding: 10, borderRadius: 6, marginTop: 6 }}>
                {JSON.stringify(reportRows.rows, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          {/* Ch. 20 §20.4 */}
          <div style={{ fontSize: 13, fontWeight: 600 }}>Explorateur d'analyses personnelles</div>
          {canCreateAnalysis && (
            <button onClick={handleCreateAnalysis} style={secondaryButtonStyle}>
              + Analyse
            </button>
          )}
        </div>
        {analyses.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune analyse enregistrée.</p>}
        {analyses.map((analysis) => (
          <div key={analysis.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {analysis.label} — <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{analysis.definition.metric}</span>
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => handleRunAnalysis(analysis)} style={secondaryButtonStyle}>
                Calculer
              </button>
              {canPromoteAnalysis && (
                <button onClick={() => handlePromote(analysis)} style={secondaryButtonStyle}>
                  Promouvoir
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* Ch. 20 §20.6 */}
          <div style={{ fontSize: 13, fontWeight: 600 }}>Simulation de tirage</div>
          <button onClick={handleSimulation} style={secondaryButtonStyle}>
            Simuler
          </button>
        </div>
      </div>
    </div>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
