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
          <pre style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, whiteSpace: "pre-wrap", background: "var(--bg, #f7f7f7)", padding: 10, borderRadius: 6 }}>
            {JSON.stringify(dashboard, null, 2)}
          </pre>
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

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13 };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
