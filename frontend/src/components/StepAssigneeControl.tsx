import { useEffect, useState } from "react";
import { getCurrentStepAssignees, assignCurrentStep, type CurrentStepAssignees } from "../api/client";

// Contrôle « Assigné à » réutilisable : montre la personne affectée à l'ÉTAPE
// COURANTE du manuscrit et, pour les profils habilités, permet de la choisir /
// changer. La liste ne propose QUE les personnes habilitées pour l'étape
// (maquettistes pour la mise en page, infographes pour l'infographie,
// correcteurs & profils éditoriaux pour la correction…). Se masque tout seul
// (« — ») quand l'étape ne se confie pas nominativement.
export function StepAssigneeControl({ manuscriptId, canAssign, display = "inline" }: { manuscriptId: string; canAssign: boolean; display?: "inline" | "block" }) {
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Affectation impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Étape sans affectation nominative : rien à afficher. Sur la fiche (mode
  // « block »), on n'affiche alors AUCUN encart (pas de « — » parasite) ; dans un
  // tableau (mode « inline »), on garde un « — » pour aligner la colonne.
  if (data && !data.has_department) return display === "block" ? null : <span style={{ color: "var(--muted)" }}>—</span>;
  const current = data?.current_assignee;

  // Mode « block » : encart titré pour la fiche de l'ouvrage — « Confier l'étape
  // « X » à… », avec la personne actuellement responsable et le bouton Assigner/
  // Changer. Permet d'affecter (ex. à l'infographe pour les références) sans
  // passer par la liste par étape.
  if (display === "block") {
    if (!data) return null;
    return (
      <div style={{ background: "var(--eclosion-soft, #FAF3DA)", border: "1px solid var(--eclosion, #D9B21A)", borderRadius: 8, padding: "10px 13px", marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 4 }}>
          Responsable de l'étape « {data.step?.label ?? "courante"} »
        </div>
        {editing && canAssign ? (
          <div onClick={(e) => e.stopPropagation()}>
            <select autoFocus defaultValue={current?.id ?? ""} disabled={busy} onChange={(e) => pick(e.target.value)} style={{ fontSize: 13, padding: "6px 9px", border: "1px solid var(--line)", borderRadius: 6, minWidth: 220 }}>
              <option value="">— Confier à… —</option>
              {data.assignees.map((a) => (
                <option key={a.id} value={a.id}>{a.username}{a.role ? ` · ${a.role}` : ""}</option>
              ))}
            </select>
            <button type="button" onClick={() => setEditing(false)} style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>✕</button>
            {data.assignees.length === 0 && <div style={{ fontSize: 11.5, color: "var(--alert, #B23A2E)", marginTop: 3 }}>Aucune personne habilitée active pour cette étape.</div>}
            {err && <div style={{ fontSize: 11.5, color: "var(--alert, #B23A2E)", marginTop: 3 }}>{err}</div>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: current ? "var(--ink)" : "var(--muted)" }}>{current ? current.username : "Non assigné"}</span>
            {canAssign && (
              <button type="button" onClick={() => setEditing(true)} style={{ background: "#fff", border: "1px solid var(--eclosion, #D9B21A)", borderRadius: 6, cursor: "pointer", color: "var(--eclosion-dark, #9a7a12)", fontSize: 12.5, fontWeight: 700, padding: "4px 12px" }}>
                {current ? "Changer la personne" : "Confier l'étape"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (editing && canAssign && data) {
    return (
      <div style={{ minWidth: 160 }} onClick={(e) => e.stopPropagation()}>
        <select autoFocus defaultValue={current?.id ?? ""} disabled={busy} onChange={(e) => pick(e.target.value)} style={{ fontSize: 12, maxWidth: 200 }}>
          <option value="">— Confier à… —</option>
          {data.assignees.map((a) => (
            <option key={a.id} value={a.id}>{a.username}{a.role ? ` · ${a.role}` : ""}</option>
          ))}
        </select>
        <button type="button" onClick={() => setEditing(false)} style={{ marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>✕</button>
        {data.assignees.length === 0 && <div style={{ fontSize: 11, color: "var(--alert, #B23A2E)", marginTop: 2 }}>Aucune personne habilitée active pour cette étape.</div>}
        {err && <div style={{ fontSize: 11, color: "var(--alert, #B23A2E)", marginTop: 2 }}>{err}</div>}
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
      <span style={{ fontSize: 12.5, color: current ? "var(--ink)" : "var(--muted)" }}>{current ? current.username : "Non assigné"}</span>
      {canAssign && (
        <button type="button" title="Choisir / changer la personne affectée" onClick={() => setEditing(true)} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", color: "var(--eclosion-dark, #9a7a12)", fontSize: 11, padding: "1px 6px" }}>
          {current ? "Changer" : "Assigner"}
        </button>
      )}
    </div>
  );
}
