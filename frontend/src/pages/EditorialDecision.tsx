import { useEffect, useMemo, useState } from "react";
import {
  getEditorialDecisionDashboard,
  type DecisionHistoryItem,
  type EditorialDecisionDashboard,
  type PendingDecision,
} from "../api/client";
import { GuidanceSteps } from "../components/GuidanceNote";

// Sous-module autonome « Direction éditoriale » (refonte du pôle éditorial).
// Même logique que « Manuscrits » / « Comité de lecture » : un MENU LOCAL en
// accordéon dont chaque entrée déroule le travail correspondant — la file des
// manuscrits à décider (avec synthèse des avis de lecture), les avis
// divergents à arbitrer, les dossiers en retard, l'historique des décisions,
// la recherche et les statistiques. La saisie de la décision (acceptation,
// refus motivé, demande de modifications) se fait dans la fiche du manuscrit,
// ouverte d'un clic. Additif : ne modifie aucun autre module.

interface Props {
  onOpenManuscript: (id: string) => void;
}

// Libellés lisibles des types de décision (enum serveur EditorialDecisionType).
const DECISION_LABELS: Record<string, string> = {
  acceptation: "Acceptation",
  acceptation_conditions: "Acceptation sous conditions",
  revision: "Demande de modifications",
  attente: "Mise en attente",
  refus: "Refus",
};

const BUCKETS = [
  { key: "a_decider", label: "À décider", icon: "⚖️" },
  { key: "divergents", label: "Avis divergents — à arbitrer", icon: "⚠️" },
  { key: "retard", label: "En retard de décision", icon: "⏰" },
  { key: "historique", label: "Décisions récentes (historique)", icon: "📜" },
  { key: "recherche", label: "Recherche", icon: "🔎" },
  { key: "stats", label: "Statistiques & indicateurs", icon: "📊" },
] as const;

export function EditorialDecision({ onOpenManuscript }: Props) {
  const [data, setData] = useState<EditorialDecisionDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("a_decider");
  const [query, setQuery] = useState("");

  useEffect(() => {
    getEditorialDecisionDashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data.pending;
    return data.pending.filter((m) => m.title.toLowerCase().includes(q) || m.manuscript_number.toLowerCase().includes(q));
  }, [data, query]);

  const count = (key: string): number | undefined => {
    if (!data) return undefined;
    if (key === "a_decider") return data.pending.length;
    if (key === "divergents") return data.pending.filter((m) => m.ecart_avis).length;
    if (key === "retard") return data.pending.filter((m) => m.en_retard).length;
    if (key === "historique") return data.historique.length;
    return undefined;
  };

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: "0 0 12px" }}>Direction éditoriale</h1>

      <GuidanceSteps
        title="Direction éditoriale — dans l'ordre"
        steps={[
          "« À décider » : ouvrez un manuscrit ; au vu de la synthèse des avis de lecture, actez la décision (acceptation, acceptation sous conditions, demande de modifications, refus motivé).",
          "« Avis divergents » : les relecteurs ne sont pas d'accord (écart de notes) — ces dossiers demandent votre arbitrage.",
          "Une acceptation lance la contractualisation ; un refus (motivé) archive le dossier. Les décisions sont tracées dans l'historique.",
        ]}
      />
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {BUCKETS.map((b) => (
          <AccordionSection
            key={b.key}
            open={section === b.key}
            onToggle={() => setSection(section === b.key ? "" : b.key)}
            icon={b.icon}
            label={b.label}
            count={count(b.key)}
          >
            {b.key === "stats" ? (
              <DecisionStats data={data} />
            ) : b.key === "historique" ? (
              <HistoryTable items={data?.historique ?? []} onOpen={onOpenManuscript} />
            ) : b.key === "recherche" ? (
              <>
                <input
                  placeholder="Rechercher un titre ou un numéro…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ padding: "8px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6, background: "#fff", minWidth: 220, width: "100%", maxWidth: 360 }}
                />
                <div style={{ marginTop: 12 }}>
                  <PendingTable items={searchResults} onOpen={onOpenManuscript} empty="Aucun manuscrit en attente ne correspond." />
                </div>
              </>
            ) : (
              <PendingTable
                items={
                  b.key === "divergents"
                    ? (data?.pending ?? []).filter((m) => m.ecart_avis)
                    : b.key === "retard"
                      ? (data?.pending ?? []).filter((m) => m.en_retard)
                      : (data?.pending ?? [])
                }
                onOpen={onOpenManuscript}
                empty={
                  b.key === "divergents"
                    ? "Aucun avis divergent à arbitrer."
                    : b.key === "retard"
                      ? "Aucune décision en retard."
                      : "Aucun manuscrit en attente de décision."
                }
              />
            )}
          </AccordionSection>
        ))}
      </div>
    </div>
  );
}

function DecisionStats({ data }: { data: EditorialDecisionDashboard | null }) {
  if (!data) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Chargement…</p>;
  const tiles: { label: string; value: string; tone?: "warn" }[] = [
    { label: "En attente de décision", value: String(data.en_attente) },
    { label: "Avis divergents", value: String(data.avis_divergents), tone: data.avis_divergents > 0 ? "warn" : undefined },
    { label: "Décisions en retard", value: String(data.en_retard), tone: data.en_retard > 0 ? "warn" : undefined },
    { label: "Taux d'acceptation", value: data.taux_acceptation != null ? `${Math.round(data.taux_acceptation * 100)} %` : "—" },
    { label: "Délai moyen de décision", value: data.delai_moyen_decision_jours != null ? `${data.delai_moyen_decision_jours} j` : "—" },
  ];
  return (
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
  );
}

function PendingTable({ items, onOpen, empty }: { items: PendingDecision[]; onOpen: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ecl-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Titre</th>
            <th>Avis</th>
            <th>Note moy.</th>
            <th>En attente</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} onClick={() => onOpen(m.id)} style={{ cursor: "pointer" }}>
              <td className="mono">{m.manuscript_number}</td>
              <td className="linklike">{m.title}</td>
              <td className="mono">{m.evaluations}</td>
              <td className="mono">{m.score_moyen != null ? m.score_moyen.toFixed(2) : "—"}</td>
              <td className="mono">{m.jours_attente} j</td>
              <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {m.ecart_avis && (
                  <span style={{ background: "var(--amber-soft, #F6E7D2)", color: "var(--amber, #C4661F)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                    avis divergents
                  </span>
                )}
                {m.en_retard && (
                  <span style={{ background: "#F6D9D3", color: "var(--alert, #C24B3A)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                    en retard
                  </span>
                )}
                {!m.ecart_avis && !m.en_retard && <span style={{ color: "var(--muted)" }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({ items, onOpen }: { items: DecisionHistoryItem[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Aucune décision enregistrée pour le moment.</p>;
  const tone = (d: string) =>
    d === "refus"
      ? { bg: "#F6D9D3", fg: "var(--alert, #C24B3A)" }
      : d === "acceptation" || d === "acceptation_conditions"
        ? { bg: "var(--eclosion-soft)", fg: "var(--eclosion-dark, #8A6A12)" }
        : { bg: "var(--amber-soft, #F6E7D2)", fg: "var(--amber, #C4661F)" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ecl-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Titre</th>
            <th>Décision</th>
            <th>Date</th>
            <th>Motivation</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => {
            const t = tone(d.decision);
            return (
              <tr key={d.id} onClick={() => onOpen(d.id)} style={{ cursor: "pointer" }}>
                <td className="mono">{d.manuscript_number}</td>
                <td className="linklike">{d.title}</td>
                <td>
                  <span style={{ background: t.bg, color: t.fg, borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                    {DECISION_LABELS[d.decision] ?? d.decision}
                  </span>
                </td>
                <td className="mono">{new Date(d.decided_at).toLocaleDateString("fr-FR")}</td>
                <td style={{ maxWidth: 320, color: "var(--muted)", fontSize: 12.5 }}>{d.motivation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Section d'accordéon du menu local (même patron que « Manuscrits »).
function AccordionSection({
  open,
  onToggle,
  icon,
  label,
  count,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: string;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)", overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: open ? "var(--eclosion-soft)" : "#fff", border: "none", padding: "12px 14px", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {count !== undefined && (
          <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #8A6A12)", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontFamily: "var(--font-mono)" }}>{count}</span>
        )}
        <span style={{ color: "var(--muted)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      </button>
      {open && <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>{children}</div>}
    </div>
  );
}
