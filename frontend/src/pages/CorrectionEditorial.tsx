import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  getCorrectionDashboard,
  getCurrentStepAssignees,
  assignCurrentStep,
  getCoverIntegrators,
  setCoverIntegrator,
  type CorrectionDashboard,
  type CorrectionManuscript,
  type CurrentStepAssignees,
} from "../api/client";
import { GuidanceSteps } from "../components/GuidanceNote";
import { AiReadingLauncher } from "../components/AiReadingLauncher";

// Sous-module « Correction éditoriale » (refonte du pôle éditorial).
// Les manuscrits en correction sont REGROUPÉS en accordéons, selon un axe
// COMMUTABLE (le « bouton » de classement) : par infographe, par éditeur
// (correcteur de l'étape) ou par STATUT de traitement. Chaque groupe affiche le
// nombre de dossiers, l'avancement moyen et une barre de progression.
// L'avancement de chaque manuscrit est l'avancement RÉEL, calculé côté serveur
// sur les 8 phases du circuit réellement déposées (texte : 1re correction,
// version intégrée, 2e correction, VCF ; couverture : 4 phases) — jamais sur des
// « tâches ». Les axes « responsable » ont une rubrique « Nouveaux à affecter »
// (sans responsable) ; l'axe « statut » sépare nouveaux à corriger (non affectés
// / à démarrer), en cours, 2e correction et entièrement corrigés. La saisie
// (dépôt des fichiers, points bloquants, validation) se fait dans la fiche du
// manuscrit, ouverte d'un clic. Additif : ne modifie aucun autre module.

interface Props {
  onOpenManuscript: (id: string) => void;
  // Droit d'affecter/changer le responsable (manuscripts:validation — Direction éditoriale).
  canAssign?: boolean;
}

// Axe de classement commutable (le « bouton » demandé) : par infographe, par
// éditeur/correcteur, ou par statut de traitement.
type Axis = "infographe" | "correcteur" | "statut";

interface Group {
  key: string; // id du responsable, "__none__" pour « à affecter », ou clé de statut
  name: string | null;
  items: CorrectionManuscript[];
  avg: number;
  blocking: number;
  late: number;
  order: number; // ordre d'affichage (axe statut)
  hint: string | null; // sous-titre explicatif (axe statut)
}

const NONE = "__none__";

// Classement par STATUT de traitement (état réel dans le circuit de correction).
function statusBucket(m: CorrectionManuscript): { key: string; label: string; order: number; hint: string } {
  if (m.sub_state === "prets_a_valider") return { key: "prets", label: "Entièrement corrigés — prêts à valider", order: 5, hint: "Les 8 phases du circuit (texte + couverture) sont déposées : l'ouvrage peut être validé et transmis à la mise en page." };
  if (m.sub_state === "a_affecter") return { key: "a_affecter", label: "Nouveaux à corriger — non affectés", order: 1, hint: "Transmis à la correction, aucun correcteur affecté, travail pas commencé." };
  if (m.sub_state === "a_demarrer") return { key: "a_demarrer", label: "Affectés — correction à démarrer", order: 2, hint: "Un correcteur est affecté mais aucune phase n'a encore été déposée." };
  if (m.in_second_correction) return { key: "deuxieme", label: "2e correction (relecture)", order: 4, hint: "La 1re correction et la version intégrée sont faites ; la 2e correction est en jeu." };
  return { key: "en_cours", label: "Correction en cours", order: 3, hint: "Au moins une phase déposée, circuit non terminé." };
}

// Clé/nom de groupe selon l'axe. Pour les axes « responsable », les manuscrits
// sans responsable tombent dans le groupe « à affecter » (NONE).
function groupKeyOf(m: CorrectionManuscript, axis: Axis): { key: string; name: string | null; order: number; hint: string | null } {
  if (axis === "statut") {
    const b = statusBucket(m);
    return { key: b.key, name: b.label, order: b.order, hint: b.hint };
  }
  const r = axis === "infographe" ? { id: m.infographe_id, name: m.infographe_name } : { id: m.correcteur_id, name: m.correcteur_name };
  return { key: r.id ?? NONE, name: r.id ? r.name : null, order: r.id ? 1 : 0, hint: null };
}

export function CorrectionEditorial({ onOpenManuscript, canAssign = false }: Props) {
  const [data, setData] = useState<CorrectionDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [axis, setAxis] = useState<Axis>("infographe");
  const [filter, setFilter] = useState<string>(""); // "" = tous ; sinon clé de groupe
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Liste des infographes (pour l'affectation directe sur l'axe « infographe »).
  const [integrators, setIntegrators] = useState<{ id: string; name: string }[]>([]);

  const reload = useCallback(() => {
    getCorrectionDashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    getCoverIntegrators().then(setIntegrators).catch(() => setIntegrators([]));
  }, []);

  // Recherche transversale (sur tous les manuscrits, hors regroupement).
  const matches = useCallback(
    (m: CorrectionManuscript) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.manuscript_number.toLowerCase().includes(q) ||
        (m.author ?? "").toLowerCase().includes(q)
      );
    },
    [query],
  );

  // Regroupement selon l'axe sélectionné (infographe, correcteur ou statut).
  const groups = useMemo<Group[]>(() => {
    if (!data) return [];
    const map = new Map<string, Group>();
    for (const m of data.manuscripts) {
      if (!matches(m)) continue;
      const gk = groupKeyOf(m, axis);
      let g = map.get(gk.key);
      if (!g) {
        g = { key: gk.key, name: gk.name, items: [], avg: 0, blocking: 0, late: 0, order: gk.order, hint: gk.hint };
        map.set(gk.key, g);
      }
      g.items.push(m);
      g.blocking += m.blocking;
      if (m.en_retard) g.late += 1;
    }
    for (const g of map.values()) {
      g.avg = g.items.length ? Math.round(g.items.reduce((s, m) => s + m.progress_pct, 0) / g.items.length) : 0;
    }
    const all = [...map.values()];
    if (axis === "statut") {
      return all.sort((a, b) => a.order - b.order);
    }
    // Axes « responsable » : « à affecter » toujours en tête, puis par nom.
    const none = map.get(NONE);
    const named = all.filter((g) => g.key !== NONE).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));
    return none ? [none, ...named] : named;
  }, [data, axis, matches]);

  const visibleGroups = useMemo(() => (filter ? groups.filter((g) => g.key === filter) : groups), [groups, filter]);

  // Réinitialise filtre/ouvertures quand on change d'axe (les clés diffèrent).
  const onAxis = (a: Axis) => {
    setAxis(a);
    setFilter("");
    setOpen({});
  };

  const axisLabel = axis === "infographe" ? "infographe" : axis === "correcteur" ? "correcteur" : "statut";
  const AXES: { key: Axis; label: string }[] = [
    { key: "infographe", label: "Par infographe" },
    { key: "correcteur", label: "Par éditeur" },
    { key: "statut", label: "Par statut" },
  ];

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: "0 0 12px" }}>Correction éditoriale</h1>

      <GuidanceSteps
        title="Correction éditoriale — dans l'ordre"
        steps={[
          "Choisissez le classement avec le bouton en haut : par infographe, par éditeur, ou par statut de traitement. Chaque groupe affiche son avancement moyen.",
          "L'avancement de chaque manuscrit est calculé sur les phases réellement déposées : texte (1re correction, version intégrée, 2e correction, VCF) et couverture (4 phases) — 8 au total.",
          "« Par statut » sépare les nouveaux à corriger (non affectés / à démarrer), ceux en cours, en 2e correction, et les entièrement corrigés. Ouvrez un manuscrit pour sa fiche de suivi détaillée.",
        ]}
      />
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}

      <CorrectionStats data={data} />

      {/* Barre d'outils : axe de regroupement + filtre responsable + recherche. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", margin: "16px 0 10px" }}>
        <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          {AXES.map((a) => (
            <button
              key={a.key}
              onClick={() => onAxis(a.key)}
              style={{
                border: "none",
                padding: "7px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: axis === a.key ? "var(--eclosion)" : "#fff",
                color: axis === a.key ? "#0B0B0C" : "var(--muted)",
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        <label style={{ fontSize: 13, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          Filtrer&nbsp;:
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}>
            <option value="">{axis === "statut" ? "Tous les statuts" : `Tous les ${axisLabel}s`}</option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {axis !== "statut" && g.key === NONE ? "Nouveaux manuscrits à affecter" : g.name} ({g.items.length})
              </option>
            ))}
          </select>
        </label>

        <input
          placeholder="Rechercher un titre, un auteur, un numéro…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ padding: "7px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6, background: "#fff", flex: "1 1 220px", maxWidth: 360 }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!data && <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>}
        {data && visibleGroups.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>Aucun manuscrit en correction{query.trim() ? " ne correspond à la recherche" : ""}.</p>
        )}
        {visibleGroups.map((g) => {
          const isNone = axis !== "statut" && g.key === NONE;
          return (
            <GroupSection
              key={g.key}
              open={!!open[g.key]}
              onToggle={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
              group={g}
              isNone={isNone}
              isStatus={axis === "statut"}
              axisLabel={axisLabel}
            >
              <CorrectionTable
                items={g.items}
                axis={axis}
                onOpen={onOpenManuscript}
                canAssign={canAssign}
                integrators={integrators}
                onChanged={reload}
                emphasizeAssign={isNone}
                empty={isNone ? "Aucun manuscrit à affecter." : "Aucun dossier."}
              />
            </GroupSection>
          );
        })}
      </div>
    </div>
  );
}

function CorrectionStats({ data }: { data: CorrectionDashboard | null }) {
  if (!data) return null;
  const tiles: { label: string; value: number; suffix?: string; tone?: "warn" | "crit" }[] = [
    { label: "En correction", value: data.en_correction },
    { label: "Nouveaux à corriger", value: data.nouveaux_a_traiter },
    { label: "En cours", value: data.en_cours },
    { label: "2e correction", value: data.deuxieme_correction },
    { label: "En attente de retour", value: data.en_attente_retour },
    { label: "Entièrement corrigés", value: data.prets_a_valider },
    { label: "Taux moyen du pôle", value: data.taux_moyen, suffix: " %" },
    { label: "Points bloquants", value: data.points_bloquants_total, tone: data.points_bloquants_total > 0 ? "crit" : undefined },
    { label: "En retard", value: data.en_retard, tone: data.en_retard > 0 ? "warn" : undefined },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
      {tiles.map((t) => {
        const color = t.tone === "crit" ? "var(--alert, #B23A2E)" : t.tone === "warn" ? "var(--amber, #B87400)" : "var(--ink)";
        const bg = t.tone === "crit" ? "#F6D9D3" : t.tone === "warn" ? "var(--amber-soft, #F6E7D2)" : "var(--eclosion-soft)";
        return (
          <div key={t.label} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: bg }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{t.value}{t.suffix ?? ""}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{t.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// En-tête d'accordéon d'un responsable (ou « à affecter ») : nom, nombre de
// dossiers, avancement moyen + barre de progression. Un clic replie/déplie.
function GroupSection({
  open,
  onToggle,
  group,
  isNone,
  isStatus,
  axisLabel,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  group: Group;
  isNone: boolean;
  isStatus: boolean;
  axisLabel: string;
  children: React.ReactNode;
}) {
  const title = isNone ? "Nouveaux manuscrits à affecter" : (group.name ?? `(${axisLabel} inconnu)`);
  const icon = isNone ? "📥" : isStatus ? "📂" : "👤";
  const highlight = isNone;
  return (
    <div style={{ border: highlight ? "1px solid var(--eclosion)" : "1px solid var(--line)", borderRadius: 10, background: "var(--card)", overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: open ? "var(--eclosion-soft)" : highlight ? "var(--eclosion-soft)" : "#fff", border: "none", padding: "12px 14px", cursor: "pointer" }}
      >
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{title}</span>
          {!isNone && (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {group.items.length} dossier{group.items.length > 1 ? "s" : ""} · avancement moyen {group.avg} %
              {group.blocking > 0 ? ` · ${group.blocking} point${group.blocking > 1 ? "s" : ""} bloquant${group.blocking > 1 ? "s" : ""}` : ""}
              {group.late > 0 ? ` · ${group.late} en retard` : ""}
            </span>
          )}
          {isStatus && group.hint && <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{group.hint}</span>}
          {isNone && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Reçoit automatiquement les manuscrits en correction pas encore confiés à un {axisLabel}.</span>}
        </span>
        {!isNone && (
          <span style={{ width: 90, flexShrink: 0 }}>
            <span style={{ display: "block", height: 6, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${group.avg}%`, background: "var(--eclosion)" }} />
            </span>
          </span>
        )}
        <span style={{ background: highlight ? "var(--eclosion)" : "var(--eclosion-soft)", color: highlight ? "#0B0B0C" : "var(--eclosion-dark, #9a7a12)", borderRadius: 999, padding: "1px 10px", fontSize: 12, fontFamily: "var(--font-mono)", flexShrink: 0 }}>{group.items.length}</span>
        <span style={{ color: "var(--muted)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }}>▸</span>
      </button>
      {open && <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>{children}</div>}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function CorrectionTable({
  items,
  axis,
  onOpen,
  empty,
  canAssign,
  integrators,
  onChanged,
  emphasizeAssign,
}: {
  items: CorrectionManuscript[];
  axis: Axis;
  onOpen: (id: string) => void;
  empty: string;
  canAssign?: boolean;
  integrators: { id: string; name: string }[];
  onChanged: () => void;
  emphasizeAssign?: boolean;
}) {
  // Relecture assistée par l'IA directement dans la liste : une ligne dépliable
  // par manuscrit ouvre les lanceurs, sans ouvrir la fiche complète.
  const [aiOpen, setAiOpen] = useState<string | null>(null);
  if (items.length === 0) return <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{empty}</p>;
  // Colonne d'affectation = l'axe de regroupement (pour confier / réaffecter) ;
  // sur l'axe « statut », on montre les deux responsables en lecture seule.
  const assignLabel = axis === "infographe" ? "Infographe" : axis === "correcteur" ? "Correcteur" : "Responsables";
  const colCount = 11;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ecl-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Titre</th>
            <th>Auteur</th>
            <th>Réception</th>
            <th>Début correction</th>
            <th>Avancement</th>
            <th>Phases</th>
            <th>Points bloquants</th>
            <th>Retard</th>
            <th>{assignLabel}</th>
            <th>IA</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <Fragment key={m.id}>
              <tr onClick={() => onOpen(m.id)} style={{ cursor: "pointer" }}>
                <td className="mono">{m.manuscript_number}</td>
                <td className="linklike">{m.title}</td>
                <td>{m.author ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                <td className="mono">{fmtDate(m.received_at)}</td>
                <td className="mono">{fmtDate(m.correction_started_at)}</td>
                <td style={{ minWidth: 120 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ display: "block", flex: 1, height: 6, background: "var(--line)", borderRadius: 999, overflow: "hidden", minWidth: 50 }}>
                      <span style={{ display: "block", height: "100%", width: `${m.progress_pct}%`, background: m.progress_pct >= 100 ? "var(--valid, #2F7D4A)" : "var(--eclosion)" }} />
                    </span>
                    <span className="mono" style={{ fontSize: 12 }}>{m.progress_pct}%</span>
                  </div>
                  {m.in_second_correction && <span style={{ fontSize: 10, color: "var(--eclosion-dark, #9a7a12)" }}>2e correction</span>}
                  {m.waiting_return && <span style={{ fontSize: 10, color: "var(--amber, #B87400)" }}>en attente de retour</span>}
                </td>
                <td className="mono" title="Phases déposées — texte / couverture">
                  <span style={{ whiteSpace: "nowrap" }}>T {m.text_done}/4 · C {m.cover_done}/4</span>
                </td>
                <td>
                  {m.blocking > 0 ? (
                    <span style={{ background: "#F6D9D3", color: "var(--alert, #B23A2E)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                      {m.blocking} à lever
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td>
                  {m.en_retard ? (
                    <span style={{ background: "var(--amber-soft, #F6E7D2)", color: "var(--amber, #B87400)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                      en retard
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
                  {axis === "infographe" ? (
                    <InfographeCell
                      manuscript={m}
                      canAssign={!!canAssign}
                      integrators={integrators}
                      onChanged={onChanged}
                      emphasize={emphasizeAssign}
                    />
                  ) : axis === "correcteur" ? (
                    <CorrectorCell manuscriptId={m.id} canAssign={!!canAssign} onChanged={onChanged} emphasize={emphasizeAssign} />
                  ) : (
                    <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      Info. : {m.infographe_name ?? "—"}<br />Corr. : {m.correcteur_name ?? "—"}
                    </span>
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
                  <td colSpan={colCount} style={{ background: "var(--paper, #FAF8F2)", padding: "6px 12px 14px" }}>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 4px" }}>
                      Relecture assistée par l'IA pour « {m.title} » — les documents produits (rapport + manuscrit corrigé) sont classés dans les Documents de l'ouvrage.
                    </div>
                    <AiReadingLauncher manuscriptId={m.id} workType="correction_1" stepCode="CORRECTION" title="Relecture IA — BAT1" hint="Produit aussi le manuscrit corrigé BAT1 (à intégrer par le correcteur). Coût plus élevé qu'un simple rapport." />
                    <AiReadingLauncher manuscriptId={m.id} workType="correction_2" stepCode="CORRECTION" title="Relecture IA — BAT2" hint="Produit aussi le manuscrit corrigé BAT2 (à intégrer par le correcteur). Coût plus élevé qu'un simple rapport." />
                    <AiReadingLauncher manuscriptId={m.id} workType="couverture" stepCode="CORRECTION" title="Relecture IA — Couverture (1ʳᵉ, dos, 4ᵉ)" askCoverPass hint="Choisissez le passage : BAT1 (1ᵉʳ) ou BAT2. Au BAT2, l'IA reçoit le rapport du BAT précédent, vérifie les intégrations, ce qui manque et les améliorations." />
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

// Cellule « Infographe » (responsable de production) : montre l'infographe et,
// pour la Direction éditoriale, permet de CHOISIR / RÉAFFECTER directement.
// La réaffectation conserve l'historique (audit côté serveur) et l'avancement.
function InfographeCell({
  manuscript,
  canAssign,
  integrators,
  onChanged,
  emphasize,
}: {
  manuscript: CorrectionManuscript;
  canAssign: boolean;
  integrators: { id: string; name: string }[];
  onChanged: () => void;
  emphasize?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = manuscript.infographe_id ? { id: manuscript.infographe_id, name: manuscript.infographe_name } : null;

  async function pick(id: string) {
    if (!id || id === current?.id) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await setCoverIntegrator(manuscript.id, id);
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Affectation impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (editing && canAssign) {
    return (
      <div style={{ minWidth: 150 }}>
        <select autoFocus defaultValue={current?.id ?? ""} disabled={busy} onChange={(e) => pick(e.target.value)} style={{ fontSize: 12, maxWidth: 190 }}>
          <option value="">— Confier à l'infographe… —</option>
          {integrators.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => setEditing(false)} style={{ marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>✕</button>
        {integrators.length === 0 && <div style={{ fontSize: 11, color: "var(--alert, #B23A2E)", marginTop: 2 }}>Aucun infographe actif.</div>}
        {err && <div style={{ fontSize: 11, color: "var(--alert, #B23A2E)", marginTop: 2 }}>{err}</div>}
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 12.5, color: current ? "var(--ink)" : "var(--muted)" }}>{current ? current.name : "Non affecté"}</span>
      {canAssign && (
        <button
          type="button"
          title="Choisir / réaffecter l'infographe"
          onClick={() => setEditing(true)}
          style={{
            background: !current && emphasize ? "var(--eclosion)" : "none",
            color: !current && emphasize ? "#0B0B0C" : "var(--eclosion-dark, #9a7a12)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: !current && emphasize ? 700 : 400,
            padding: "1px 6px",
          }}
        >
          {current ? "Réaffecter" : "Affecter"}
        </button>
      )}
    </div>
  );
}

// Cellule « Correcteur assigné » : montre qui fait la correction et, pour la
// Direction éditoriale, permet de CHOISIR / CHANGER le correcteur — parmi les
// correcteurs UNIQUEMENT (un infographe n'apparaît jamais dans la liste).
function CorrectorCell({ manuscriptId, canAssign, onChanged, emphasize }: { manuscriptId: string; canAssign: boolean; onChanged?: () => void; emphasize?: boolean }) {
  const [data, setData] = useState<CurrentStepAssignees | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    getCurrentStepAssignees(manuscriptId).then(setData).catch(() => setData(null));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manuscriptId]);

  async function pick(id: string) {
    if (!id) return;
    setBusy(true); setErr(null);
    try {
      await assignCurrentStep(manuscriptId, id);
      setEditing(false);
      load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Affectation impossible.");
    } finally {
      setBusy(false);
    }
  }

  const current = data?.current_assignee;
  if (editing && canAssign && data) {
    return (
      <div style={{ minWidth: 150 }}>
        <select autoFocus defaultValue={current?.id ?? ""} disabled={busy} onChange={(e) => pick(e.target.value)} style={{ fontSize: 12, maxWidth: 190 }}>
          <option value="">— Confier la correction à… —</option>
          {data.assignees.map((a) => (
            <option key={a.id} value={a.id}>{a.username}{a.role ? ` · ${a.role}` : ""}</option>
          ))}
        </select>
        <button type="button" onClick={() => setEditing(false)} style={{ marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>✕</button>
        {data.assignees.length === 0 && <div style={{ fontSize: 11, color: "var(--alert, #B23A2E)", marginTop: 2 }}>Aucune personne habilitée active (correcteur, relecteur, direction ou assistant éditorial).</div>}
        {err && <div style={{ fontSize: 11, color: "var(--alert, #B23A2E)", marginTop: 2 }}>{err}</div>}
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 12.5, color: current ? "var(--ink)" : "var(--muted)" }}>{current ? current.username : "Non assigné"}</span>
      {canAssign && (
        <button
          type="button"
          title="Choisir / changer le correcteur"
          onClick={() => setEditing(true)}
          style={{
            background: !current && emphasize ? "var(--eclosion)" : "none",
            color: !current && emphasize ? "#0B0B0C" : "var(--eclosion-dark, #9a7a12)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: !current && emphasize ? 700 : 400,
            padding: "1px 6px",
          }}
        >
          {current ? "Changer" : "Assigner"}
        </button>
      )}
    </div>
  );
}
