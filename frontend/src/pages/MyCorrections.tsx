import { useEffect, useState } from "react";
import {
  listMyCorrections,
  taskManuscriptFileUrl,
  uploadCorrectedFile,
  patchTask,
  getCorrectionBookTypes,
  type MyCorrectionTask,
  type BookTypeOption,
  type SupportOption,
} from "../api/client";
import { Button } from "../components/Button";
import { GuidanceNote } from "../components/GuidanceNote";
import { AiReadingLauncher } from "../components/AiReadingLauncher";
import { StartingProofPanel } from "../components/StartingProofPanel";
import { CorrectionCyclePanel } from "../components/CorrectionCyclePanel";

// Boîte de travail personnelle du correcteur (parallèle de « Mes lectures »).
// Menu local en accordéon : ses tâches de correction regroupées par état. Sur
// chaque tâche, l'ENTRÉE (ouvrir le manuscrit à corriger) et la SORTIE (déposer
// la version corrigée, reçue par la Maquette). Additif : ne modifie aucun autre
// module. Le correcteur travaille sans détenir le droit large « documents ».

const TYPE_LABELS: Record<string, string> = {
  correction: "Correction éditoriale",
  correction_ortho: "Orthographe",
  correction_gramm: "Grammaire",
  correction_typo: "Typographie",
  correction_syntaxe: "Syntaxe",
  correction_style: "Style",
  harmonisation: "Harmonisation",
  verif_biblio: "Vérification bibliographique",
  coherence: "Cohérence",
};

export function MyCorrections() {
  const [tasks, setTasks] = useState<MyCorrectionTask[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("a_faire");
  const [bookTypes, setBookTypes] = useState<BookTypeOption[]>([]);
  const [supports, setSupports] = useState<SupportOption[]>([]);

  useEffect(() => {
    getCorrectionBookTypes().then((r) => { setBookTypes(r.book_types); setSupports(r.supports); }).catch(() => { setBookTypes([]); setSupports([]); });
  }, []);

  const refresh = () =>
    listMyCorrections()
      .then((t) => {
        setTasks(t);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));

  useEffect(() => {
    refresh();
  }, []);

  async function depose(task: MyCorrectionTask, file: File) {
    try {
      await uploadCorrectedFile(task.id, file);
      setMessage(`Version corrigée déposée pour « ${task.manuscript?.title ?? "l'ouvrage"} » — reçue par la Maquette.`);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Dépôt impossible.");
    }
  }

  const buckets: { key: string; label: string; icon: string; match: (t: MyCorrectionTask) => boolean; empty: string }[] = [
    { key: "a_faire", label: "À faire", icon: "📝", match: (t) => t.status === "non_commencee", empty: "Aucune correction à démarrer." },
    { key: "en_cours", label: "En cours", icon: "🔧", match: (t) => t.status === "en_cours" || t.status === "suspendue", empty: "Aucune correction en cours." },
    { key: "terminees", label: "Terminées", icon: "✅", match: (t) => t.status === "terminee" || t.status === "validee", empty: "Aucune correction terminée." },
  ];

  return (
    <div className="ecl-page" style={{ maxWidth: 1040 }}>
      <h1 className="ecl-page__title">Mes corrections</h1>
      <p className="ecl-page__lead">Vos tâches de correction : le manuscrit à corriger, et le dépôt de votre version corrigée.</p>

      <GuidanceNote title="Votre boîte de correction personnelle">
        Cette page n'affiche que les corrections confiées à VOTRE compte. Sur chaque tâche : ouvrez le manuscrit à corriger
        (« À corriger »), utilisez l'<strong>assistance IA</strong> (relecture BAT1 / BAT2 / couverture) et récupérez les
        <strong> BAT produits</strong> dans « Assistance IA &amp; BAT », puis déposez votre version corrigée (« À remettre ») —
        elle sera reçue par la Maquette pour la mise en page.
      </GuidanceNote>

      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 }}>{message}</div>
      )}
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {buckets.map((b) => {
          const items = tasks.filter(b.match);
          return (
            <AccordionSection key={b.key} open={section === b.key} onToggle={() => setSection(section === b.key ? "" : b.key)} icon={b.icon} label={b.label} count={items.length}>
              {items.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{b.empty}</p>
              ) : (
                items.map((task) => <CorrectionCard key={task.id} task={task} onDepose={depose} onRefresh={refresh} bookTypes={bookTypes} supports={supports} />)
              )}
            </AccordionSection>
          );
        })}
      </div>
    </div>
  );
}

function CorrectionCard({ task, onDepose, onRefresh, bookTypes, supports }: { task: MyCorrectionTask; onDepose: (t: MyCorrectionTask, f: File) => void; onRefresh: () => void; bookTypes: BookTypeOption[]; supports: SupportOption[] }) {
  const canValidate = task.status !== "terminee" && task.status !== "validee";
  // Paramètres du moteur de correction : type d'ouvrage (charge la grille) +
  // support analysé. La grille adaptée est appliquée automatiquement à l'IA.
  const [bookType, setBookType] = useState<string>("");
  const [support, setSupport] = useState<string>("manuscrit_interieur");
  // Écran complet de correction par ouvrage — le circuit du début à la fin :
  //   • la matière à corriger (VC1 : manuscrit + couvertures 1ère/dos/4ème) ;
  //   • le cycle en 2 temps avec relais correcteur ↔ intégrateur (BAT1 → version
  //     intégrée → BAT2 → version corrigée finale) ;
  //   • l'assistance IA branchée sur la bonne matière à chaque passage.
  // Ouvert d'un clic, sous la tâche. Nécessite l'ouvrage.
  const [workspace, setWorkspace] = useState(false);
  const manuscriptId = task.manuscript?.id ?? null;
  return (
    <section className="ecl-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)" }}>{task.manuscript?.title ?? "—"}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>{TYPE_LABELS[task.type] ?? task.type}</span>
            {task.plannedEnd && <span>· échéance {new Date(task.plannedEnd).toLocaleDateString("fr-FR")}</span>}
            <span style={{ fontFamily: "var(--font-mono)" }}>· {task.progressPct} %</span>
          </div>
        </div>
      </div>

      {/* ENTRÉE : le manuscrit à corriger. */}
      <div style={handoffRow}>
        <span style={handoffTag("in")}>À corriger</span>
        {task.manuscriptHasFile ? (
          <a href={taskManuscriptFileUrl(task.id)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📖 Ouvrir le manuscrit à corriger
          </a>
        ) : (
          <span style={{ color: "var(--muted)" }}>Le fichier du manuscrit n'a pas encore été déposé sur l'ouvrage.</span>
        )}
      </div>

      {/* SORTIE : la version corrigée, reçue par la Maquette. */}
      <div style={handoffRow}>
        <span style={handoffTag("out")}>À remettre</span>
        <label style={fileBtnStyle}>
          {task.correctedHasFile ? "Remplacer la version corrigée" : "Déposer la version corrigée (fichier)"}
          <input
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onDepose(task, f);
              e.target.value = "";
            }}
          />
        </label>
        <span style={{ color: "var(--muted)", fontSize: 11.5 }}>→ reçu par la Maquette</span>
      </div>

      {/* ÉCRAN COMPLET : assistance IA + BAT déposés (livrables produits). */}
      {manuscriptId && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setWorkspace((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: workspace ? "var(--eclosion-soft)" : "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}
          >
            <span style={{ fontSize: 15 }}>🤖</span>
            <span style={{ flex: 1 }}>Assistance de correction éditoriale IA — Éditions Éclosion</span>
            <span style={{ color: "var(--muted)", display: "inline-block", transform: workspace ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
          </button>
          {workspace && (
            <div style={{ marginTop: 8 }}>
              {/* 1 — La matière à corriger (VC1) : manuscrit + couvertures. En
                  lecture seule ici (déposée en amont à la Planification). */}
              <StartingProofPanel manuscriptId={manuscriptId} canManage={false} />

              {/* 2 — Le cycle en deux temps + relais correcteur ↔ intégrateur :
                  BAT1 → version intégrée → BAT2 → version corrigée finale. */}
              <CorrectionCyclePanel manuscriptId={manuscriptId} canManage />

              {/* 3 — Paramètres du moteur : type d'ouvrage + support. La grille de
                  contrôle adaptée se charge automatiquement (sévérités C1/C2/C3/S). */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper, #FAF8F2)" }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 }}>
                  Type d'ouvrage
                  <select value={bookType} onChange={(e) => setBookType(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, minWidth: 180 }}>
                    <option value="">Grille par défaut</option>
                    {bookTypes.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12.5, fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 }}>
                  Support analysé
                  <select value={support} onChange={(e) => setSupport(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, minWidth: 180 }}>
                    {supports.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </label>
                <span style={{ fontSize: 11.5, color: "var(--muted)", flex: 1, minWidth: 160 }}>
                  La grille de contrôle adaptée au type se charge automatiquement (sévérités C1 bloquant · C2 important · C3 mineur · S suggestion).
                </span>
              </div>

              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "12px 0 4px", lineHeight: 1.6 }}>
                Les documents produits (manuscrit corrigé + rapport) apparaissent dans « 📦 Générer les livrables », prêts à
                télécharger puis à redéposer dans la phase correspondante ci-dessus.
              </p>
              <AiReadingLauncher manuscriptId={manuscriptId} workType="correction_1" stepCode="CORRECTION" bookTypeCode={bookType || null} support={support} title="Correction éditoriale — BAT1 (1re relecture)" hint="Lit le manuscrit à corriger (VC1) et produit le rapport + le manuscrit corrigé BAT1. À intégrer ensuite en « Version intégrée »." />
              <AiReadingLauncher manuscriptId={manuscriptId} workType="correction_2" stepCode="CORRECTION" bookTypeCode={bookType || null} support={support} title="Correction éditoriale — BAT2 (2e relecture, contrôle après intégration)" hint="Lit la VERSION INTÉGRÉE du 1er passage (pas l'original) et pointe, correction par correction, ce qui a été intégré / non intégré / partiel / modifié + nouvelles anomalies." />
              <AiReadingLauncher manuscriptId={manuscriptId} workType="couverture" stepCode="CORRECTION" bookTypeCode={bookType || null} support="couverture" askCoverPass title="Correction éditoriale — Couverture (1ʳᵉ, dos, 4ᵉ)" hint="Analyse les 3 faces (1ère, dos, 4ème) + cohérence couverture/intérieur + ISBN. Choisissez le passage : BAT1 ou BAT2 (suivi du passage précédent)." />
            </div>
          )}
        </div>
      )}

      {/* Bouton de validation d'étape (avancement à 100 % / terminé). */}
      {canValidate && (
        <div style={{ marginTop: 12 }}>
          <Button
            variant="add"
            size="sm"
            onClick={async () => {
              await patchTask(task.id, { status: "terminee", progress_pct: 100 });
              onRefresh();
            }}
          >
            ✓ Marquer la correction terminée
          </Button>
        </div>
      )}
    </section>
  );
}

// Section d'accordéon du menu local (même patron que « Mes lectures »).
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

const fileBtnStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "4px 10px",
};
const handoffRow: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 12.5 };
function handoffTag(dir: "in" | "out"): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: dir === "in" ? "var(--eclosion-dark, #9a7a12)" : "#2E6B4F",
    background: dir === "in" ? "var(--eclosion-soft)" : "#DDF0E5",
    borderRadius: 999,
    padding: "2px 9px",
    whiteSpace: "nowrap",
  };
}
