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
          setActivities(p.activities.map((a) => ({ ...a, responsible: a.responsible ?? "", dependencies: a.dependencies ?? "", observations: a.observations ?? "" })));
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

  async function save() {
    if (activities.some((a) => !a.label.trim())) { setError("Chaque activité doit avoir un intitulé."); return; }
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
      setMessage(`Planning enregistré (version ${saved.version}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

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

      {/* Activités */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11 }}>
              <th style={{ padding: "4px 6px", minWidth: 200 }}>Activité</th>
              <th style={{ padding: "4px 6px" }}>Responsable</th>
              <th style={{ padding: "4px 6px" }}>Début</th>
              <th style={{ padding: "4px 6px" }}>Fin</th>
              <th style={{ padding: "4px 6px" }}>Durée</th>
              <th style={{ padding: "4px 6px" }}>Priorité</th>
              <th style={{ padding: "4px 6px" }}>Statut</th>
              {canManage && <th style={{ padding: "4px 6px" }}></th>}
            </tr>
          </thead>
          <tbody>
            {activities.map((a, i) => {
              const dur = durationDays(a.start_date, a.end_date);
              return (
                <tr key={i} style={{ borderTop: "1px solid var(--line)", verticalAlign: "top" }}>
                  <td style={{ padding: "5px 6px" }}>
                    <input value={a.label} disabled={!canManage} onChange={(e) => updateActivity(i, { label: e.target.value })} style={inputStyle} placeholder="Intitulé de l'activité" />
                    <input value={a.dependencies ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { dependencies: e.target.value })} style={{ ...inputStyle, marginTop: 4 }} placeholder="Dépendances (facultatif)" />
                    <input value={a.observations ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { observations: e.target.value })} style={{ ...inputStyle, marginTop: 4 }} placeholder="Observations (facultatif)" />
                  </td>
                  <td style={{ padding: "5px 6px" }}><input value={a.responsible ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { responsible: e.target.value })} style={{ ...inputStyle, minWidth: 110 }} /></td>
                  <td style={{ padding: "5px 6px" }}><input type="date" value={toDateInput(a.start_date)} disabled={!canManage} onChange={(e) => updateActivity(i, { start_date: e.target.value || null })} style={inputStyle} /></td>
                  <td style={{ padding: "5px 6px" }}><input type="date" value={toDateInput(a.end_date)} disabled={!canManage} onChange={(e) => updateActivity(i, { end_date: e.target.value || null })} style={inputStyle} /></td>
                  <td style={{ padding: "5px 6px", whiteSpace: "nowrap", color: "var(--muted)" }}>{dur !== null ? `${dur} j` : "—"}</td>
                  <td style={{ padding: "5px 6px" }}>
                    <select value={a.priority} disabled={!canManage} onChange={(e) => updateActivity(i, { priority: e.target.value as ProjectActivityPriority })} style={inputStyle}>
                      {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "5px 6px" }}>
                    <select value={a.status} disabled={!canManage} onChange={(e) => updateActivity(i, { status: e.target.value as ProjectActivityStatus })} style={inputStyle}>
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  {canManage && (
                    <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>
                      <button type="button" title="Monter" onClick={() => move(i, -1)} style={miniBtn}>↑</button>
                      <button type="button" title="Descendre" onClick={() => move(i, 1)} style={miniBtn}>↓</button>
                      <button type="button" title="Retirer" onClick={() => { setActivities((c) => c.filter((_, j) => j !== i)); touch(); }} style={{ ...miniBtn, color: "var(--danger, #B23A2E)" }}>✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {activities.length === 0 && (
              <tr><td colSpan={canManage ? 8 : 7} style={{ padding: "8px 6px", color: "var(--muted)" }}>Aucune activité. Ajoutez la première étape du projet.</td></tr>
            )}
          </tbody>
        </table>
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
        {canManage && <Button variant="add" size="sm" type="button" disabled={busy || !dirty} onClick={save}>{busy ? "…" : "Enregistrer le planning"}</Button>}
        {version > 0 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Version {version} enregistrée.</span>}
        <div style={{ marginLeft: "auto" }}>
          <DocPrintMenu
            label="Aperçu / Imprimer / PDF"
            onPrint={(opts) => {
              if (dirty) { setError("Enregistrez le planning avant d'imprimer (des modifications ne sont pas sauvegardées)."); return; }
              printProjectPlan(printData(), opts, cachet);
            }}
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
