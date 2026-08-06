import { useEffect, useState } from "react";
import {
  getTrainingRequests,
  createTrainingRequest,
  setTrainingRequestStatus,
  getTrainingSessions,
  createTrainingSession,
  setTrainingSessionStatus,
  getTrainingParticipants,
  enrollTrainingParticipant,
  setTrainingParticipantStatus,
  type TrainingRequest,
  type TrainingSession,
  type TrainingParticipant,
  type TrainingParticipationStatus,
  type Employee,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Field } from "./Modal";

// Formation (module amont RH) : demandes de formation, sessions planifiées et
// suivi de la participation (émargement présent / absent).

const REQ_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  demandee: { label: "Demandée", bg: "var(--eclosion-soft)", fg: "var(--eclosion)" },
  approuvee: { label: "Approuvée", bg: "#e6efe4", fg: "#3B7A34" },
  refusee: { label: "Refusée", bg: "#f8e3df", fg: "var(--danger, #C24B3A)" },
  planifiee: { label: "Planifiée", bg: "#F7E7DA", fg: "#C4661F" },
};
const SESSION_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  planifiee: { label: "Planifiée", bg: "var(--eclosion-soft)", fg: "var(--eclosion)" },
  realisee: { label: "Réalisée", bg: "#e6efe4", fg: "#3B7A34" },
  annulee: { label: "Annulée", bg: "#eceef2", fg: "var(--muted)" },
};
const PART_STATUS: Record<TrainingParticipationStatus, { label: string; bg: string; fg: string }> = {
  inscrit: { label: "Inscrit", bg: "var(--eclosion-soft)", fg: "var(--eclosion)" },
  present: { label: "Présent", bg: "#e6efe4", fg: "#3B7A34" },
  absent: { label: "Absent", bg: "#f8e3df", fg: "var(--danger, #C24B3A)" },
};

function Chip({ s }: { s: { label: string; bg: string; fg: string } }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap", background: s.bg, color: s.fg }}>{s.label}</span>;
}

export function FormationSection({ canManage, canValidate, employees }: { canManage: boolean; canValidate: boolean; employees: Employee[] }) {
  const [requests, setRequests] = useState<TrainingRequest[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reqForm, setReqForm] = useState({ employee_id: "", topic: "", motivation: "" });
  const [showReqForm, setShowReqForm] = useState(false);
  const [sessForm, setSessForm] = useState({ title: "", provider: "", theme: "", mode: "presentiel", session_date: "", cost: "" });
  const [showSessForm, setShowSessForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadRequests = () => getTrainingRequests().then(setRequests).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  const loadSessions = () => getTrainingSessions().then(setSessions).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { loadRequests(); loadSessions(); /* eslint-disable-next-line */ }, []);

  async function submitRequest() {
    setError(null);
    try {
      await createTrainingRequest({ employee_id: reqForm.employee_id, topic: reqForm.topic.trim(), motivation: reqForm.motivation.trim() || undefined });
      setReqForm({ employee_id: "", topic: "", motivation: "" });
      setShowReqForm(false);
      await loadRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
  }
  async function decideRequest(id: string, status: TrainingRequest["status"]) {
    setError(null);
    try { await setTrainingRequestStatus(id, status); await loadRequests(); } catch (e) { setError(e instanceof Error ? e.message : "Modification impossible."); }
  }
  async function submitSession() {
    setError(null);
    try {
      await createTrainingSession({
        title: sessForm.title.trim(),
        provider: sessForm.provider.trim() || undefined,
        theme: sessForm.theme.trim() || undefined,
        mode: sessForm.mode as "presentiel" | "distanciel",
        session_date: sessForm.session_date ? new Date(sessForm.session_date).toISOString() : undefined,
        cost: sessForm.cost ? Number(sessForm.cost) : undefined,
      });
      setSessForm({ title: "", provider: "", theme: "", mode: "presentiel", session_date: "", cost: "" });
      setShowSessForm(false);
      await loadSessions();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
  }
  async function changeSessionStatus(id: string, status: TrainingSession["status"]) {
    setError(null);
    try { await setTrainingSessionStatus(id, status); await loadSessions(); } catch (e) { setError(e instanceof Error ? e.message : "Modification impossible."); }
  }

  return (
    <Card title="Formation" subtitle="Demandes de formation, sessions planifiées et suivi de participation.">
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {/* ── Demandes ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Demandes de formation</div>
        {canManage && <Button variant="add" size="sm" onClick={() => setShowReqForm((v) => !v)}>{showReqForm ? "Fermer" : "+ Demande"}</Button>}
      </div>
      {showReqForm && canManage && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            <Field label="Collaborateur">
              <select value={reqForm.employee_id} onChange={(e) => setReqForm({ ...reqForm, employee_id: e.target.value })}>
                <option value="">—</option>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>)}
              </select>
            </Field>
            <Field label="Sujet"><input value={reqForm.topic} onChange={(e) => setReqForm({ ...reqForm, topic: e.target.value })} placeholder="Ex. InDesign avancé" /></Field>
          </div>
          <div style={{ marginTop: 8 }}><Field label="Motivation"><textarea rows={2} value={reqForm.motivation} onChange={(e) => setReqForm({ ...reqForm, motivation: e.target.value })} /></Field></div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button variant="add" size="sm" type="button" disabled={!reqForm.employee_id || reqForm.topic.trim().length < 2} onClick={submitRequest}>Enregistrer la demande</Button>
          </div>
        </div>
      )}
      {requests.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "0 0 12px" }}>Aucune demande.</p>}
      <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
        {requests.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.topic} <Chip s={REQ_STATUS[r.status]} /></div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.employee}{r.motivation ? ` · ${r.motivation}` : ""}</div>
            </div>
            {canValidate && r.status === "demandee" && (
              <div style={{ display: "flex", gap: 6 }}>
                <Button variant="edit" size="sm" onClick={() => decideRequest(r.id, "approuvee")}>Approuver</Button>
                <Button variant="danger" size="sm" onClick={() => decideRequest(r.id, "refusee")}>Refuser</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Sessions ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Sessions de formation</div>
        {canManage && <Button variant="add" size="sm" onClick={() => setShowSessForm((v) => !v)}>{showSessForm ? "Fermer" : "+ Session"}</Button>}
      </div>
      {showSessForm && canManage && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <Field label="Intitulé"><input value={sessForm.title} onChange={(e) => setSessForm({ ...sessForm, title: e.target.value })} /></Field>
            <Field label="Organisme"><input value={sessForm.provider} onChange={(e) => setSessForm({ ...sessForm, provider: e.target.value })} /></Field>
            <Field label="Thème"><input value={sessForm.theme} onChange={(e) => setSessForm({ ...sessForm, theme: e.target.value })} /></Field>
            <Field label="Mode">
              <select value={sessForm.mode} onChange={(e) => setSessForm({ ...sessForm, mode: e.target.value })}>
                <option value="presentiel">Présentiel</option>
                <option value="distanciel">Distanciel</option>
              </select>
            </Field>
            <Field label="Date"><input type="date" value={sessForm.session_date} onChange={(e) => setSessForm({ ...sessForm, session_date: e.target.value })} /></Field>
            <Field label="Coût (FCFA)"><input type="number" min={0} value={sessForm.cost} onChange={(e) => setSessForm({ ...sessForm, cost: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button variant="add" size="sm" type="button" disabled={sessForm.title.trim().length < 2} onClick={submitSession}>Planifier la session</Button>
          </div>
        </div>
      )}
      {sessions.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>Aucune session.</p>}
      <div className="ecl-list">
        {sessions.map((s) => (
          <div key={s.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title} <Chip s={SESSION_STATUS[s.status]} /></div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {[s.provider, s.theme, s.mode === "distanciel" ? "Distanciel" : "Présentiel"].filter(Boolean).join(" · ")}
                  {s.session_date ? <> · <span style={{ fontFamily: "var(--font-mono)" }}>{s.session_date.slice(0, 10)}</span></> : null}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{s.participants_total} inscrit(s) · {s.participants_by_status.present} présent(s)</span>
                <Button variant="view" size="sm" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{expanded === s.id ? "Masquer" : "Participants"}</Button>
                {canValidate && s.status === "planifiee" && (
                  <>
                    <Button variant="edit" size="sm" onClick={() => changeSessionStatus(s.id, "realisee")}>Réalisée</Button>
                    <Button variant="danger" size="sm" onClick={() => changeSessionStatus(s.id, "annulee")}>Annuler</Button>
                  </>
                )}
              </div>
            </div>
            {expanded === s.id && <ParticipantsPanel sessionId={s.id} canManage={canManage} employees={employees} onChanged={loadSessions} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ParticipantsPanel({ sessionId, canManage, employees, onChanged }: { sessionId: string; canManage: boolean; employees: Employee[]; onChanged: () => void }) {
  const [parts, setParts] = useState<TrainingParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");

  const load = () => getTrainingParticipants(sessionId).then(setParts).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sessionId]);

  async function enroll() {
    if (!pick) return;
    setError(null);
    try { await enrollTrainingParticipant(sessionId, pick); setPick(""); await load(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Inscription impossible."); }
  }
  async function mark(id: string, status: TrainingParticipationStatus) {
    setError(null);
    try { await setTrainingParticipantStatus(id, status); await load(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Modification impossible."); }
  }

  const enrolledIds = new Set(parts.map((p) => p.employee_id));
  const available = employees.filter((e) => !enrolledIds.has(e.id));

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
      {canManage && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 180 }}>
            <Field label="Inscrire un collaborateur">
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">—</option>
                {available.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>)}
              </select>
            </Field>
          </div>
          <Button variant="add" size="sm" type="button" disabled={!pick} onClick={enroll}>Inscrire</Button>
        </div>
      )}
      {parts.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>Aucun participant.</p>}
      <div style={{ display: "grid", gap: 6 }}>
        {parts.map((p) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline", padding: "4px 0" }}>
            <div style={{ fontSize: 13 }}>{p.employee} <Chip s={PART_STATUS[p.status]} /></div>
            {canManage && (
              <div style={{ display: "flex", gap: 6 }}>
                <Button variant="edit" size="sm" onClick={() => mark(p.id, "present")}>Présent</Button>
                <Button variant="danger" size="sm" onClick={() => mark(p.id, "absent")}>Absent</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
