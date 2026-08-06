import { useEffect, useState } from "react";
import { getEmployeeContracts, createEmployeeContract, addContractAmendment, type HrContractRow } from "../api/client";
import { Button } from "./Button";
import { Field } from "./Modal";

// Contrats de travail & avenants d'un employé (refonte RH — Étape 3). Liste des
// contrats, ajout d'un contrat, et avenants tracés par contrat (date d'effet).
const TYPE_LABELS: Record<string, string> = { cdi: "CDI", cdd: "CDD", stage: "Stage", prestation: "Prestation" };

export function ContractsModal({ employeeId, employeeName, canManage, onClose }: { employeeId: string; employeeName: string; canManage: boolean; onClose: () => void }) {
  const [contracts, setContracts] = useState<HrContractRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newContract, setNewContract] = useState({ type: "cdi", start_date: new Date().toISOString().slice(0, 10), end_date: "" });
  const [amendFor, setAmendFor] = useState<string | null>(null);
  const [amend, setAmend] = useState({ effective_date: new Date().toISOString().slice(0, 10), subject: "", description: "" });

  const load = () => getEmployeeContracts(employeeId).then(setContracts).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [employeeId]);

  async function addContract() {
    try {
      await createEmployeeContract(employeeId, { type: newContract.type, start_date: new Date(newContract.start_date).toISOString(), end_date: newContract.end_date ? new Date(newContract.end_date).toISOString() : undefined });
      setNewContract({ type: "cdi", start_date: new Date().toISOString().slice(0, 10), end_date: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Ajout impossible."); }
  }
  async function saveAmendment(contractId: string) {
    if (!amend.subject.trim()) return;
    try {
      await addContractAmendment(employeeId, contractId, { effective_date: new Date(amend.effective_date).toISOString(), subject: amend.subject.trim(), description: amend.description.trim() || undefined });
      setAmendFor(null);
      setAmend({ effective_date: new Date().toISOString().slice(0, 10), subject: "", description: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Ajout de l'avenant impossible."); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,61,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }} onClick={onClose}>
      <div style={{ background: "var(--card, #fff)", borderRadius: 12, padding: 18, maxWidth: 620, width: "100%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ fontFamily: "var(--font-title)", fontSize: 16 }}>Contrats de travail — {employeeName}</div>
          <button onClick={onClose} aria-label="Fermer" style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 10 }}>{error}</div>}

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {contracts.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun contrat de travail enregistré.</p>}
          {contracts.map((c) => (
            <div key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{TYPE_LABELS[c.type] ?? c.type}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                  {c.startDate.slice(0, 10)}{c.endDate ? ` → ${c.endDate.slice(0, 10)}` : ""}
                </div>
              </div>

              {c.amendments.length > 0 && (
                <div style={{ marginTop: 8, borderLeft: "2px solid var(--eclosion)", paddingLeft: 10, display: "grid", gap: 6 }}>
                  {c.amendments.map((a) => (
                    <div key={a.id} style={{ fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>Avenant</span> · <span style={{ fontFamily: "var(--font-mono)" }}>{a.effectiveDate.slice(0, 10)}</span> — {a.subject}
                      {a.description && <div style={{ color: "var(--muted)" }}>{a.description}</div>}
                    </div>
                  ))}
                </div>
              )}

              {canManage && (amendFor === c.id ? (
                <div style={{ marginTop: 10, display: "grid", gap: 8, background: "var(--eclosion-soft)", borderRadius: 8, padding: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                    <Field label="Date d'effet"><input type="date" value={amend.effective_date} onChange={(e) => setAmend({ ...amend, effective_date: e.target.value })} /></Field>
                    <Field label="Objet de l'avenant"><input value={amend.subject} onChange={(e) => setAmend({ ...amend, subject: e.target.value })} placeholder="Ex. : augmentation, changement de poste…" /></Field>
                  </div>
                  <Field label="Détail (facultatif)"><textarea rows={2} value={amend.description} onChange={(e) => setAmend({ ...amend, description: e.target.value })} /></Field>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Button variant="view" size="sm" type="button" onClick={() => setAmendFor(null)}>Annuler</Button>
                    <Button variant="add" size="sm" type="button" disabled={!amend.subject.trim()} onClick={() => saveAmendment(c.id)}>Enregistrer l'avenant</Button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setAmendFor(c.id)} style={{ marginTop: 8, background: "none", border: "none", color: "var(--eclosion-dark, #8A6A12)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>+ Ajouter un avenant</button>
              ))}
            </div>
          ))}
        </div>

        {canManage && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Nouveau contrat de travail</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, alignItems: "end" }}>
              <Field label="Type"><select value={newContract.type} onChange={(e) => setNewContract({ ...newContract, type: e.target.value })}>{Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Début"><input type="date" value={newContract.start_date} onChange={(e) => setNewContract({ ...newContract, start_date: e.target.value })} /></Field>
              <Field label="Fin (facultatif)"><input type="date" value={newContract.end_date} onChange={(e) => setNewContract({ ...newContract, end_date: e.target.value })} /></Field>
              <Button variant="add" size="sm" type="button" onClick={addContract}>Ajouter</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
