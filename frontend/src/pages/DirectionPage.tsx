import { useEffect, useState } from "react";
import {
  decideRecommendation,
  generateRecommendations,
  getDirectionDashboard,
  listAlerts,
  listRecommendations,
  searchGlobal,
  type Alert,
  type DirectionDashboard,
  type Manuscript,
  type Recommendation,
} from "../api/client";
import { DataTable } from "../components/DataTable";

const PRIORITY_COLORS: Record<string, string> = {
  faible: "var(--muted)",
  moyenne: "var(--eclosion)",
  elevee: "var(--late, #C4661F)",
  critique: "var(--alert)",
};

interface DirectionPageProps {
  canTreatRecommendations: boolean;
}

// Ch. 5 : tableau de bord Direction générale consolidé, recherche globale,
// alertes automatiques et centre de pilotage intelligent (Ch. 5 §5.9).
export function DirectionPage({ canTreatRecommendations }: DirectionPageProps) {
  const [dashboard, setDashboard] = useState<DirectionDashboard | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Manuscript[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [dashboardData, alertList, recommendationList] = await Promise.all([
      getDirectionDashboard(),
      listAlerts(),
      listRecommendations({ status: "open" }),
    ]);
    setDashboard(dashboardData);
    setAlerts(alertList);
    setRecommendations(recommendationList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    try {
      setResults(await searchGlobal(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la recherche.");
    }
  }

  async function handleGenerate() {
    try {
      const result = await generateRecommendations();
      setMessage(`${result.created} nouvelle(s) recommandation(s) générée(s).`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la génération.");
    }
  }

  async function handleDecide(recommendation: Recommendation, status: "treated" | "ignored" | "postponed") {
    const comment = window.prompt("Commentaire (optionnel)") ?? undefined;
    try {
      await decideRecommendation(recommendation.id, status, comment || undefined);
      setMessage("Recommandation traitée.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du traitement.");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Direction générale</h1>
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
        {/* Ch. 5 §5.1 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Tableau de bord consolidé</div>
        {dashboard ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <DomainBlock title="Éditorial">
              <TileRow>
                <StatTile label="Manuscrits" value={dashboard.editorial.total} />
                <StatTile label="Statuts actifs" value={dashboard.editorial.by_status.length} />
              </TileRow>
              <DataTable
                rows={dashboard.editorial.by_status.map(({ code: _code, ...rest }) => rest)}
                emptyLabel="Aucun manuscrit."
              />
            </DomainBlock>

            <DomainBlock title="Production">
              <TileRow>
                <StatTile label="Projets en cours" value={dashboard.production.projects_in_progress} />
                <StatTile label="Tâches terminées" value={dashboard.production.tasks_done} />
                <StatTile label="Tâches en retard" value={dashboard.production.tasks_late} tone={dashboard.production.tasks_late > 0 ? "late" : undefined} />
                <StatTile
                  label="Respect des délais"
                  value={dashboard.production.on_time_rate_pct === null ? "—" : `${dashboard.production.on_time_rate_pct} %`}
                />
              </TileRow>
            </DomainBlock>

            <DomainBlock title="Commercial">
              <TileRow>
                <StatTile label="Exemplaires vendus" value={dashboard.commercial.units_sold} />
                <StatTile label="Chiffre d'affaires" value={dashboard.commercial.revenue_total} />
                <StatTile label="Ruptures de stock" value={dashboard.commercial.stock_outs} tone={dashboard.commercial.stock_outs > 0 ? "alert" : undefined} />
              </TileRow>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Meilleures ventes</div>
              <DataTable rows={dashboard.commercial.best_sellers} emptyLabel="Aucune vente enregistrée." />
            </DomainBlock>

            <DomainBlock title="Financier">
              {dashboard.financial ? (
                <TileRow>
                  <StatTile label="Coût de production" value={dashboard.financial.production_cost_total} />
                  <StatTile label="Dépenses engagées" value={dashboard.financial.expenses_engaged} />
                  <StatTile label="Droits d'auteur dus" value={dashboard.financial.royalties_due} />
                  <StatTile label="Factures en attente" value={dashboard.financial.invoices_pending} />
                  <StatTile
                    label="Position de trésorerie"
                    value={dashboard.financial.treasury_position}
                    tone={dashboard.financial.treasury_position < 0 ? "alert" : undefined}
                  />
                </TileRow>
              ) : (
                <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
                  Réservé aux profils habilités (consultation financière).
                </p>
              )}
            </DomainBlock>
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
        )}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        {/* Ch. 5 §5.4 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recherche globale</div>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 10 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Numéro, titre, contributeur, collection, ISBN…"
            style={{ ...inputStyle, marginTop: 0, flex: 1 }}
          />
          <button type="submit" style={secondaryButtonStyle}>
            Rechercher
          </button>
        </form>
        {results.map((manuscript) => (
          <div key={manuscript.id} style={{ borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            {manuscript.manuscriptNumber} — {manuscript.title} — {manuscript.status.label}
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        {/* Ch. 5 §5.6 */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Alertes automatiques</div>
        {alerts.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune alerte.</p>}
        {alerts.map((alert, i) => (
          <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13, color: PRIORITY_COLORS[alert.priority] }}>
            [{alert.priority}] {alert.message}
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          {/* Ch. 5 §5.9 */}
          <div style={{ fontSize: 13, fontWeight: 600 }}>Centre de pilotage intelligent</div>
          <button onClick={handleGenerate} style={secondaryButtonStyle}>
            Générer les recommandations
          </button>
        </div>
        {recommendations.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune recommandation ouverte.</p>}
        {recommendations.map((recommendation) => (
          <div key={recommendation.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: PRIORITY_COLORS[recommendation.priority] }}>
              [{recommendation.priority}] {recommendation.message}
            </span>
            {canTreatRecommendations && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => handleDecide(recommendation, "treated")} style={secondaryButtonStyle}>
                  Traiter
                </button>
                <button onClick={() => handleDecide(recommendation, "postponed")} style={secondaryButtonStyle}>
                  Reporter
                </button>
                <button onClick={() => handleDecide(recommendation, "ignored")} style={secondaryButtonStyle}>
                  Ignorer
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Bloc d'un domaine du tableau de bord (Éditorial, Production…).
function DomainBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--eclosion)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// Rangée de cartes-chiffres, repliable sur les petits écrans.
function TileRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{children}</div>;
}

// Carte-chiffre : un indicateur unique (guide de style §3, chiffre en chasse fixe).
function StatTile({ label, value, tone }: { label: string; value: number | string; tone?: "late" | "alert" }) {
  const color = tone === "alert" ? "var(--alert)" : tone === "late" ? "var(--amber)" : "var(--ink)";
  const display = typeof value === "number" ? value.toLocaleString("fr-FR") : value;
  return (
    <div style={{ flex: "1 1 140px", minWidth: 140, border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, color }}>{display}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13 };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
