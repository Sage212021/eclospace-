import { useEffect, useState } from "react";
import { getEmployeeEvaluations, saveEmployeeEvaluation, type EmployeeEvaluation } from "../api/client";
import { Button } from "./Button";
import { Field } from "./Modal";

// Évaluations annuelles d'un collaborateur (refonte RH — Étape 4) : note globale
// (1–5), points forts, axes de progrès et objectifs individuels pour l'année.
export function EvaluationsModal({ employeeId, employeeName, canManage, onClose }: { employeeId: string; employeeName: string; canManage: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<EmployeeEvaluation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ year: new Date().getFullYear(), rating: 3, strengths: "", areas_to_improve: "", objectives: "" });
  const [saving, setSaving] = useState(false);

  const load = () => getEmployeeEvaluations(employeeId).then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [employeeId]);

  function edit(ev: EmployeeEvaluation) {
    setForm({ year: ev.year, rating: ev.rating, strengths: ev.strengths ?? "", areas_to_improve: ev.areasToImprove ?? "", objectives: ev.objectives ?? "" });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveEmployeeEvaluation(employeeId, { year: form.year, rating: form.rating, strengths: form.strengths.trim() || undefined, areas_to_improve: form.areas_to_improve.trim() || undefined, objectives: form.objectives.trim() || undefined });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const stars = (n: number) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }} onClick={onClose}>
      <div style={{ background: "var(--card, #fff)", borderRadius: 12, padding: 18, maxWidth: 600, width: "100%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ fontFamily: "var(--font-title)", fontSize: 16 }}>Évaluations — {employeeName}</div>
          <button onClick={onClose} aria-label="Fermer" style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 10 }}>{error}</div>}

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {rows.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune évaluation enregistrée.</p>}
          {rows.map((ev) => (
            <div key={ev.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Année {ev.year} · <span style={{ color: "var(--eclosion-dark, #9a7a12)" }}>{stars(ev.rating)}</span> ({ev.rating}/5)</div>
                {canManage && <button type="button" onClick={() => edit(ev)} style={{ background: "none", border: "none", color: "var(--eclosion-dark, #9a7a12)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Modifier</button>}
              </div>
              {ev.strengths && <div style={{ fontSize: 12.5, marginTop: 4 }}><b>Points forts :</b> {ev.strengths}</div>}
              {ev.areasToImprove && <div style={{ fontSize: 12.5, marginTop: 2 }}><b>Axes de progrès :</b> {ev.areasToImprove}</div>}
              {ev.objectives && <div style={{ fontSize: 12.5, marginTop: 2 }}><b>Objectifs :</b> {ev.objectives}</div>}
            </div>
          ))}
        </div>

        {canManage && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Enregistrer une évaluation</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
              <Field label="Année"><input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} /></Field>
              <Field label="Note globale (1–5)"><input type="number" min={1} max={5} value={form.rating} onChange={(e) => setForm({ ...form, rating: Math.max(1, Math.min(5, Number(e.target.value))) })} /></Field>
            </div>
            <div style={{ marginTop: 8 }}><Field label="Points forts"><textarea rows={2} value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} /></Field></div>
            <div style={{ marginTop: 8 }}><Field label="Axes de progrès"><textarea rows={2} value={form.areas_to_improve} onChange={(e) => setForm({ ...form, areas_to_improve: e.target.value })} /></Field></div>
            <div style={{ marginTop: 8 }}><Field label="Objectifs individuels (année à venir)"><textarea rows={2} value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} /></Field></div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <Button variant="add" size="sm" type="button" disabled={saving} onClick={save}>{saving ? "…" : "Enregistrer l'évaluation"}</Button>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Une seule évaluation par année (ré-enregistrer met à jour l'année.)</p>
          </div>
        )}
      </div>
    </div>
  );
}
