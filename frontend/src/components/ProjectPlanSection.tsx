import { useEffect, useMemo, useState } from "react";
import {
  getProjectPlan,
  saveProjectPlan,
  getBranding,
  type ProjectPlanActivity,
  type ProjectActivityPriority,
  type ProjectActivityStatus,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { DocPrintMenu } from "./DocPrintMenu";
import { printProjectPlan, type ProjectPlanPrintData } from "../lib/print";

// Planification du projet SAISIE dans Eclospace (plus de fichier à déposer) :
// informations générales + activités datées, liées au manuscrit. Après
// enregistrement : aperçu / impression / PDF officiel (en-tête + bloc
// « Direction éditoriale » avec le cachet enregistré dans le système).

const PRIORITIES: { value: ProjectActivityPriority; label: string }[] = [
  { value: "basse", label: "Basse" },
  { value: "normale", label: "Normale" },
  { value: "haute", label: "Haute" },
];
const STATUSES: { value: ProjectActivityStatus; label: string }[] = [
  { value: "a_faire", label: "À faire" },
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminé" },
];

const emptyActivity = (): ProjectPlanActivity => ({
  label: "",
  responsible: "",
  location: "",
  start_date: null,
  end_date: null,
  priority: "normale",
  status: "a_faire",
  dependencies: "",
  observations: "",
});

// yyyy-mm-dd pour <input type="date"> ; renvoie "" si vide/invalide.
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const durationDays = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db) || db < da) return null;
  return Math.round((db - da) / 86_400_000) + 1;
};

const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit" };

export function ProjectPlanSection({ manuscriptId, manuscriptTitle, manuscriptNumber, canManage }: { manuscriptId: string; manuscriptTitle: string; manuscriptNumber: string; canManage: boolean }) {
  const [manager, setManager] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [objectives, setObjectives] = useState("");
  const [notes, setNotes] = useState("");
  const [activities, setActivities] = useState<ProjectPlanActivity[]>([]);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cachet, setCachet] = useState<string | null>(null);

  useEffect(() => {
    getProjectPlan(manuscriptId)
      .then((p) => {
        if (p) {
          setManager(p.manager_name ?? "");
          setStart(toDateInput(p.start_date));
          setEnd(toDateInput(p.end_date));
          setObjectives(p.objectives ?? "");
          setNotes(p.notes ?? "");
          setActivities(p.activities.map((a) => ({ ...a, responsible: a.responsible ?? "", location: a.location ?? "", dependencies: a.dependencies ?? "", observations: a.observations ?? "" })));
          setVersion(p.version);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => setLoaded(true));
    getBranding().then((b) => setCachet(b.cachet_editoriale)).catch(() => {});
  }, [manuscriptId]);

  const progress = useMemo(() => {
    if (activities.length === 0) return 0;
    return Math.round((activities.filter((a) => a.status === "termine").length / activities.length) * 100);
  }, [activities]);
  const globalDuration = durationDays(start ? `${start}T00:00:00` : null, end ? `${end}T00:00:00` : null);

  const touch = () => { setDirty(true); setMessage(null); };
  const updateActivity = (i: number, patch: Partial<ProjectPlanActivity>) => {
    setActivities((cur) => cur.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    touch();
  };
  const move = (i: number, dir: -1 | 1) => {
    setActivities((cur) => {
      const next = [...cur];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touch();
  };

  const hasEmptyLabel = activities.some((a) => !a.label.trim());

  async function save(quiet = false) {
    if (hasEmptyLabel) { if (!quiet) setError("Chaque activité doit avoir un intitulé."); return; }
    setBusy(true); setError(null);
    try {
      const saved = await saveProjectPlan(manuscriptId, {
        manager_name: manager.trim() || null,
        start_date: start || null,
        end_date: end || null,
        objectives: objectives.trim() || null,
        notes: notes.trim() || null,
        activities: activities.map((a) => ({
          label: a.label.trim(),
          responsible: (a.responsible ?? "").trim() || null,
          location: (a.location ?? "").trim() || null,
          start_date: a.start_date || null,
          end_date: a.end_date || null,
          priority: a.priority,
          status: a.status,
          dependencies: (a.dependencies ?? "").trim() || null,
          observations: (a.observations ?? "").trim() || null,
        })),
      });
      setVersion(saved.version);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      if (!quiet) setMessage(`Planning enregistré (version ${saved.version}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Sauvegarde AUTOMATIQUE : après une pause de saisie, le planning est
  // enregistré sans action de l'utilisateur (dès qu'il est valide). Le bouton
  // « Enregistrer maintenant » reste disponible comme filet.
  useEffect(() => {
    if (!canManage || !dirty || busy || hasEmptyLabel) return;
    const t = setTimeout(() => { void save(true); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, hasEmptyLabel, manager, start, end, objectives, notes, activities]);

  const printData = (): ProjectPlanPrintData => ({
    manuscriptTitle,
    manuscriptNumber,
    managerName: manager.trim() || null,
    startDate: start ? `${start}T00:00:00` : null,
    endDate: end ? `${end}T00:00:00` : null,
    objectives: objectives.trim() || null,
    notes: notes.trim() || null,
    version: version || 1,
    activities: activities.map((a) => ({
      label: a.label, responsible: (a.responsible ?? "").trim() || null,
      location: (a.location ?? "").trim() || null,
      startDate: a.start_date, endDate: a.end_date,
      priority: a.priority, status: a.status,
      dependencies: (a.dependencies ?? "").trim() || null, observations: (a.observations ?? "").trim() || null,
    })),
  });

  if (!loaded) return null;

  return (
    <Card title="Planification du projet" subtitle="Renseignez le planning ici : il est lié au projet et devient un document officiel (aperçu + PDF), sans fichier à déposer." collapsible defaultOpen>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #B23A2E)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {/* Informations générales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Responsable du projet
          <input value={manager} disabled={!canManage} onChange={(e) => { setManager(e.target.value); touch(); }} style={inputStyle} placeholder="Nom du responsable" />
        </label>
        <label style={{ fontSize: 12 }}>Date de début prévue
          <input type="date" value={start} disabled={!canManage} onChange={(e) => { setStart(e.target.value); touch(); }} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>Date de fin prévue
          <input type="date" value={end} disabled={!canManage} onChange={(e) => { setEnd(e.target.value); touch(); }} style={inputStyle} />
        </label>
      </div>
      <label style={{ fontSize: 12, display: "block", marginBottom: 12 }}>Objectifs / livrables
        <textarea value={objectives} disabled={!canManage} onChange={(e) => { setObjectives(e.target.value); touch(); }} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Ce que le projet doit produire…" />
      </label>

      {/* Indicateurs calculés */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, marginBottom: 10, color: "var(--ink)" }}>
        <span>Activités : <b>{activities.length}</b></span>
        {globalDuration !== null && <span>Durée globale : <b>{globalDuration} j</b></span>}
        <span>Avancement : <b>{progress}%</b></span>
      </div>

      {/* Activités — une CARTE par activité (lisible sur mobile), en nombre
          illimité (actions, dédicaces, lieux…). */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {activities.length === 0 && (
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Aucune activité. Ajoutez la première étape du projet (ou une date de dédicace).</p>
        )}
        {activities.map((a, i) => {
          const dur = durationDays(a.start_date, a.end_date);
          return (
            <div key={i} style={{ border: "1px solid var(--line)", borderLeft: "3px solid var(--eclosion, #D9B21A)", borderRadius: 8, padding: 10, background: "var(--paper, #faf8f2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", minWidth: 20 }}>{i + 1}.</span>
                <input value={a.label} disabled={!canManage} onChange={(e) => updateActivity(i, { label: e.target.value })} style={{ ...inputStyle, fontWeight: 600 }} placeholder="Intitulé de l'activité (ex. : Dédicace à Douala)" />
                {canManage && (
                  <span style={{ whiteSpace: "nowrap" }}>
                    <button type="button" title="Monter" onClick={() => move(i, -1)} style={miniBtn}>↑</button>
                    <button type="button" title="Descendre" onClick={() => move(i, 1)} style={miniBtn}>↓</button>
                    <button type="button" title="Retirer" onClick={() => { setActivities((c) => c.filter((_, j) => j !== i)); touch(); }} style={{ ...miniBtn, color: "var(--danger, #B23A2E)" }}>✕</button>
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                <label style={miniLabel}>Responsable
                  <input value={a.responsible ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { responsible: e.target.value })} style={inputStyle} placeholder="Qui ?" />
                </label>
                <label style={miniLabel}>Lieu
                  <input value={a.location ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { location: e.target.value })} style={inputStyle} placeholder="Ex. : Douala (GECAM)" />
                </label>
                <label style={miniLabel}>Début
                  <input type="date" value={toDateInput(a.start_date)} disabled={!canManage} onChange={(e) => updateActivity(i, { start_date: e.target.value || null })} style={inputStyle} />
                </label>
                <label style={miniLabel}>Fin
                  <input type="date" value={toDateInput(a.end_date)} disabled={!canManage} onChange={(e) => updateActivity(i, { end_date: e.target.value || null })} style={inputStyle} />
                </label>
                <label style={miniLabel}>Priorité
                  <select value={a.priority} disabled={!canManage} onChange={(e) => updateActivity(i, { priority: e.target.value as ProjectActivityPriority })} style={inputStyle}>
                    {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <label style={miniLabel}>Statut
                  <select value={a.status} disabled={!canManage} onChange={(e) => updateActivity(i, { status: e.target.value as ProjectActivityStatus })} style={inputStyle}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 8 }}>
                <input value={a.dependencies ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { dependencies: e.target.value })} style={inputStyle} placeholder="Dépendances (facultatif)" />
                <input value={a.observations ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { observations: e.target.value })} style={inputStyle} placeholder="Observations (facultatif)" />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Durée : {dur !== null ? `${dur} j` : "—"}</div>
            </div>
          );
        })}
      </div>

      {canManage && (
        <div style={{ marginTop: 8 }}>
          <Button variant="view" size="sm" type="button" onClick={() => { setActivities((c) => [...c, emptyActivity()]); touch(); }}>+ Ajouter une activité</Button>
        </div>
      )}

      <label style={{ fontSize: 12, display: "block", margin: "12px 0" }}>Observations et points de vigilance
        <textarea value={notes} disabled={!canManage} onChange={(e) => { setNotes(e.target.value); touch(); }} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        {canManage && <Button variant="add" size="sm" type="button" disabled={busy || !dirty} onClick={() => save(false)}>{busy ? "…" : "Enregistrer maintenant"}</Button>}
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {busy ? "Enregistrement…" : dirty ? "Modifications en cours — sauvegarde automatique…" : savedAt ? `Enregistré automatiquement à ${savedAt}${version ? ` (version ${version})` : ""}.` : version > 0 ? `Version ${version} enregistrée.` : "Sauvegarde automatique activée."}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <DocPrintMenu
            label="Aperçu / Imprimer / PDF"
            onPrint={(opts) => printProjectPlan(printData(), opts, cachet)}
          />
        </div>
      </div>
      {!cachet && (
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Astuce : téléversez le cachet « Direction éditoriale » dans Réglages → Cachets &amp; signature pour qu'il apparaisse automatiquement sur le PDF.</p>
      )}
    </Card>
  );
}

const miniBtn: React.CSSProperties = { background: "none", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 7px", fontSize: 12, cursor: "pointer", marginRight: 3 };
const miniLabel: React.CSSProperties = { fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 };
