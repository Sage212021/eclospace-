import { useEffect, useMemo, useState } from "react";
import {
  getReadingCommitteeDashboard,
  type CommitteeManuscript,
  type CommitteeSubState,
  type ReadingCommitteeDashboard,
} from "../api/client";
import { GuidanceSteps } from "../components/GuidanceNote";

// Sous-module autonome « Comité de lecture » (refonte du pôle éditorial).
// Même logique que « Manuscrits » : un MENU LOCAL en accordéon dont chaque
// entrée déroule le travail correspondant (manuscrits à affecter, en lecture,
// rapports remis à clore), plus recherche et statistiques. Additif : ne
// modifie aucun autre module. Les actions de saisie (affecter un relecteur,
// clore le comité) se font dans la fiche du manuscrit, ouverte d'un clic.

interface Props {
  onOpenManuscript: (id: string) => void;
}

const BUCKETS: { key: CommitteeSubState | "recherche" | "stats"; label: string; icon: string }[] = [
  { key: "a_affecter", label: "À affecter (aucun relecteur)", icon: "📋" },
  { key: "en_lecture", label: "En lecture (rapports en cours)", icon: "👓" },
  { key: "rapports_remis", label: "Rapports remis — à clore", icon: "📝" },
  { key: "recherche", label: "Recherche", icon: "🔎" },
  { key: "stats", label: "Statistiques & indicateurs", icon: "📊" },
];

export function ReadingCommittee({ onOpenManuscript }: Props) {
  const [data, setData] = useState<ReadingCommitteeDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("a_affecter");
  const [query, setQuery] = useState("");

  const load = () =>
    getReadingCommitteeDashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));

  useEffect(() => {
    load();
  }, []);

  const bySubState = (s: CommitteeSubState) => data?.manuscripts.filter((m) => m.sub_state === s) ?? [];

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data.manuscripts;
    return data.manuscripts.filter(
      (m) => m.title.toLowerCase().includes(q) || m.manuscript_number.toLowerCase().includes(q),
    );
  }, [data, query]);

  const count = (key: string): number | undefined => {
    if (key === "a_affecter" || key === "en_lecture" || key === "rapports_remis") return bySubState(key).length;
    return undefined;
  };

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: "0 0 12px" }}>Comité de lecture</h1>

      <GuidanceSteps
        title="Comité de lecture — dans l'ordre"
        steps={[
          "« À affecter » : ouvrez un manuscrit et désignez un ou plusieurs relecteurs (chacun reçoit sa mission dans « Mes lectures »).",
          "« En lecture » : les relecteurs remettent leurs rapports. Vous suivez ici les missions en cours et les retards.",
          "« Rapports remis » : quand tous les rapports sont là, ouvrez le manuscrit et cliquez « Clore le comité » → il passe à la décision éditoriale.",
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
              <CommitteeStats data={data} />
            ) : b.key === "recherche" ? (
              <>
                <input
                  placeholder="Rechercher un titre ou un numéro…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ padding: "8px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6, background: "#fff", minWidth: 220, width: "100%", maxWidth: 360 }}
                />
                <div style={{ marginTop: 12 }}>
                  <CommitteeTable items={searchResults} onOpen={onOpenManuscript} empty="Aucun manuscrit au comité ne correspond." />
                </div>
              </>
            ) : (
              <CommitteeTable
                items={bySubState(b.key)}
                onOpen={onOpenManuscript}
                empty={
                  b.key === "a_affecter"
                    ? "Aucun manuscrit en attente d'affectation."
                    : b.key === "en_lecture"
                      ? "Aucune lecture en cours."
                      : "Aucun manuscrit prêt à clore."
                }
              />
            )}
          </AccordionSection>
        ))}
      </div>
    </div>
  );
}

function CommitteeStats({ data }: { data: ReadingCommitteeDashboard | null }) {
  if (!data) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Chargement…</p>;
  const tiles: { label: string; value: number; tone?: "warn" }[] = [
    { label: "Manuscrits au comité", value: data.en_comite },
    { label: "À affecter", value: data.a_affecter },
    { label: "En lecture", value: data.en_lecture },
    { label: "Rapports remis (à clore)", value: data.rapports_remis },
    { label: "Rapports en attente", value: data.rapports_en_attente },
    { label: "Relecteurs actifs", value: data.relecteurs_actifs },
    { label: "Dossiers en retard", value: data.en_retard, tone: data.en_retard > 0 ? "warn" : undefined },
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

function CommitteeTable({ items, onOpen, empty }: { items: CommitteeManuscript[]; onOpen: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ecl-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Titre</th>
            <th>Reçu le</th>
            <th>Missions</th>
            <th>Rapports remis</th>
            <th>Retard</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} onClick={() => onOpen(m.id)} style={{ cursor: "pointer" }}>
              <td className="mono">{m.manuscript_number}</td>
              <td className="linklike">{m.title}</td>
              <td className="mono">{new Date(m.received_at).toLocaleDateString("fr-FR")}</td>
              <td className="mono">{m.assigned}</td>
              <td className="mono">
                {m.submitted}/{m.assigned}
              </td>
              <td>
                {m.late > 0 ? (
                  <span style={{ background: "var(--amber-soft, #F6E7D2)", color: "var(--amber, #C4661F)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                    {m.late} en retard
                  </span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </td>
            </tr>
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
          <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #8A6A12)", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontFamily: "var(--font-mono)" }}>{count}</span>
        )}
        <span style={{ color: "var(--muted)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      </button>
      {open && <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>{children}</div>}
    </div>
  );
}
