import { Fragment, useEffect, useMemo, useState } from "react";
import { getCorrectionDashboard, type CorrectionDashboard, type CorrectionManuscript, type CorrectionSubState } from "../api/client";
import { GuidanceSteps } from "../components/GuidanceNote";
import { AiReadingLauncher } from "../components/AiReadingLauncher";

// Sous-module autonome « Correction éditoriale » (refonte du pôle éditorial).
// Même logique que « Manuscrits » / « Comité de lecture » / « Direction
// éditoriale » : un MENU LOCAL en accordéon dont chaque entrée déroule le
// travail correspondant — corrections à démarrer, en cours, points bloquants à
// lever, prêts à valider, plus recherche et statistiques. La saisie (dépôt du
// manuscrit corrigé, points bloquants, validation) se fait dans la fiche du
// manuscrit, ouverte d'un clic. Additif : ne modifie aucun autre module.

interface Props {
  onOpenManuscript: (id: string) => void;
}

const BUCKETS: { key: CorrectionSubState | "recherche" | "stats"; label: string; icon: string }[] = [
  { key: "points_bloquants", label: "Points bloquants — à lever", icon: "🚫" },
  { key: "a_demarrer", label: "À démarrer", icon: "✍️" },
  { key: "en_cours", label: "En cours", icon: "🔧" },
  { key: "prets_a_valider", label: "Prêts à valider", icon: "✅" },
  { key: "recherche", label: "Recherche", icon: "🔎" },
  { key: "stats", label: "Statistiques & indicateurs", icon: "📊" },
];

export function CorrectionEditorial({ onOpenManuscript }: Props) {
  const [data, setData] = useState<CorrectionDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("points_bloquants");
  const [query, setQuery] = useState("");

  useEffect(() => {
    getCorrectionDashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const bySubState = (s: CorrectionSubState) => data?.manuscripts.filter((m) => m.sub_state === s) ?? [];

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data.manuscripts;
    return data.manuscripts.filter((m) => m.title.toLowerCase().includes(q) || m.manuscript_number.toLowerCase().includes(q));
  }, [data, query]);

  const count = (key: string): number | undefined => {
    if (key === "points_bloquants" || key === "a_demarrer" || key === "en_cours" || key === "prets_a_valider") return bySubState(key).length;
    return undefined;
  };

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: "0 0 12px" }}>Correction éditoriale</h1>

      <GuidanceSteps
        title="Correction éditoriale — dans l'ordre"
        steps={[
          "Ouvrez un manuscrit : le correcteur y dépose le manuscrit corrigé (« Correction et versions ») et signale ses points bloquants.",
          "« Points bloquants » : ces dossiers ne peuvent pas être validés tant que les points ne sont pas levés (résolus).",
          "Quand la correction est terminée et sans point bloquant, le dossier est « prêt à valider » → validez l'étape pour passer à la mise en page.",
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
              <CorrectionStats data={data} />
            ) : b.key === "recherche" ? (
              <>
                <input
                  placeholder="Rechercher un titre ou un numéro…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ padding: "8px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6, background: "#fff", minWidth: 220, width: "100%", maxWidth: 360 }}
                />
                <div style={{ marginTop: 12 }}>
                  <CorrectionTable items={searchResults} onOpen={onOpenManuscript} empty="Aucun manuscrit en correction ne correspond." />
                </div>
              </>
            ) : (
              <CorrectionTable
                items={bySubState(b.key)}
                onOpen={onOpenManuscript}
                empty={
                  b.key === "points_bloquants"
                    ? "Aucun point bloquant en attente."
                    : b.key === "a_demarrer"
                      ? "Aucune correction à démarrer."
                      : b.key === "en_cours"
                        ? "Aucune correction en cours."
                        : "Aucun manuscrit prêt à valider."
                }
              />
            )}
          </AccordionSection>
        ))}
      </div>
    </div>
  );
}

function CorrectionStats({ data }: { data: CorrectionDashboard | null }) {
  if (!data) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Chargement…</p>;
  const tiles: { label: string; value: number; tone?: "warn" | "crit" }[] = [
    { label: "En correction", value: data.en_correction },
    { label: "À démarrer", value: data.a_demarrer },
    { label: "En cours", value: data.en_cours },
    { label: "Prêts à valider", value: data.prets_a_valider },
    { label: "Points bloquants", value: data.points_bloquants_total, tone: data.points_bloquants_total > 0 ? "crit" : undefined },
    { label: "Dossiers en retard", value: data.en_retard, tone: data.en_retard > 0 ? "warn" : undefined },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
      {tiles.map((t) => {
        const color = t.tone === "crit" ? "var(--alert, #C24B3A)" : t.tone === "warn" ? "var(--amber, #C4661F)" : "var(--ink)";
        const bg = t.tone === "crit" ? "#F6D9D3" : t.tone === "warn" ? "var(--amber-soft, #F6E7D2)" : "var(--eclosion-soft)";
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

function CorrectionTable({ items, onOpen, empty }: { items: CorrectionManuscript[]; onOpen: (id: string) => void; empty: string }) {
  // Relecture assistée par l'IA directement dans la liste de correction : une
  // ligne dépliable par manuscrit ouvre les lanceurs (1ʳᵉ / 2ᵉ correction,
  // couverture), sans avoir à ouvrir la fiche complète de l'ouvrage.
  const [aiOpen, setAiOpen] = useState<string | null>(null);
  if (items.length === 0) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ecl-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Titre</th>
            <th>Tâches</th>
            <th>Avancement</th>
            <th>Points bloquants</th>
            <th>Retard</th>
            <th>IA</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <Fragment key={m.id}>
              <tr onClick={() => onOpen(m.id)} style={{ cursor: "pointer" }}>
                <td className="mono">{m.manuscript_number}</td>
                <td className="linklike">{m.title}</td>
                <td className="mono">
                  {m.tasks_done}/{m.tasks_total}
                </td>
                <td className="mono">{m.progress_pct} %</td>
                <td>
                  {m.blocking > 0 ? (
                    <span style={{ background: "#F6D9D3", color: "var(--alert, #C24B3A)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                      {m.blocking} à lever
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td>
                  {m.en_retard ? (
                    <span style={{ background: "var(--amber-soft, #F6E7D2)", color: "var(--amber, #C4661F)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                      en retard
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAiOpen(aiOpen === m.id ? null : m.id);
                    }}
                    title="Relecture assistée par l'IA"
                    style={{ background: aiOpen === m.id ? "var(--eclosion)" : "#fff", color: aiOpen === m.id ? "#0B0B0C" : "var(--eclosion-dark, #9a7a12)", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    🤖 IA
                  </button>
                </td>
              </tr>
              {aiOpen === m.id && (
                <tr>
                  <td colSpan={7} style={{ background: "var(--paper, #FAF8F2)", padding: "6px 12px 14px" }}>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 4px" }}>
                      Relecture assistée par l'IA pour « {m.title} » — les documents produits (rapport + manuscrit corrigé) sont classés dans les Documents de l'ouvrage.
                    </div>
                    <AiReadingLauncher manuscriptId={m.id} workType="correction_1" stepCode="CORRECTION" title="Relecture IA — BAT1" hint="Produit aussi le manuscrit corrigé BAT1 (à intégrer par le correcteur). Coût plus élevé qu'un simple rapport." />
                    <AiReadingLauncher manuscriptId={m.id} workType="correction_2" stepCode="CORRECTION" title="Relecture IA — BAT2" hint="Produit aussi le manuscrit corrigé BAT2 (à intégrer par le correcteur). Coût plus élevé qu'un simple rapport." />
                    <AiReadingLauncher manuscriptId={m.id} workType="couverture" stepCode="CORRECTION" title="Relecture IA — Couverture (1ʳᵉ, dos, 4ᵉ)" hint="Au 1ᵉʳ passage (BAT1) : relecture complète. Au 2ᵉ passage (BAT2) : vérifie si les corrections ont été intégrées, ce qui manque et les améliorations de l'auteur." />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
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
          <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontFamily: "var(--font-mono)" }}>{count}</span>
        )}
        <span style={{ color: "var(--muted)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      </button>
      {open && <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>{children}</div>}
    </div>
  );
}
