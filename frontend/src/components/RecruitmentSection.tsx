import { useEffect, useState } from "react";
import {
  getJobOpenings,
  createJobOpening,
  setJobOpeningStatus,
  getJobApplications,
  createJobApplication,
  setJobApplicationStatus,
  type JobOpening,
  type JobApplication,
  type JobApplicationStatus,
  type Department,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Field } from "./Modal";
import { printJobApplications, printAllJobApplications } from "../lib/print";
import { listAllJobApplications } from "../api/client";

// Recrutement (module amont RH) : postes à pourvoir et candidatures. Un poste
// ouvert reçoit des candidatures ; chaque candidature suit le circuit
// reçue → entretien → retenue / refusée ; le poste se clôt (pourvu / annulé).

const OPENING_STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  ouvert: { label: "Ouvert", bg: "var(--eclosion-soft)", fg: "var(--eclosion)" },
  pourvu: { label: "Pourvu", bg: "#e6efe4", fg: "#3B7A34" },
  annule: { label: "Annulé", bg: "#eceef2", fg: "var(--muted)" },
};

const APP_STATUS_LABEL: Record<JobApplicationStatus, { label: string; bg: string; fg: string }> = {
  recue: { label: "Reçue", bg: "var(--eclosion-soft)", fg: "var(--eclosion)" },
  entretien: { label: "Entretien", bg: "#F7E7DA", fg: "#C4661F" },
  retenue: { label: "Retenue", bg: "#e6efe4", fg: "#3B7A34" },
  refusee: { label: "Refusée", bg: "#f8e3df", fg: "var(--danger, #C24B3A)" },
};

function Chip({ s }: { s: { label: string; bg: string; fg: string } }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap", background: s.bg, color: s.fg }}>{s.label}</span>;
}

export function RecruitmentSection({ canManage, canValidate, departments }: { canManage: boolean; canValidate: boolean; departments: Department[] }) {
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", department_id: "", contract_type: "", description: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  // Impression globale de toutes les candidatures, avec filtre facultatif par statut.
  const [printStatus, setPrintStatus] = useState("");
  const [printingAll, setPrintingAll] = useState(false);

  const STATUS_FR: Record<string, string> = { recue: "Reçue", entretien: "Entretien", retenue: "Retenue", refusee: "Refusée" };
  async function printAll() {
    setPrintingAll(true); setError(null);
    try {
      const apps = await listAllJobApplications(printStatus || undefined);
      printAllJobApplications({ filterLabel: printStatus ? `Statut : ${STATUS_FR[printStatus] ?? printStatus}` : undefined, apps });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impression impossible.");
    } finally { setPrintingAll(false); }
  }

  const load = () => getJobOpenings().then(setOpenings).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function submitOpening() {
    setError(null);
    try {
      await createJobOpening({
        title: form.title.trim(),
        department_id: form.department_id || undefined,
        contract_type: form.contract_type || undefined,
        description: form.description.trim() || undefined,
      });
      setForm({ title: "", department_id: "", contract_type: "", description: "" });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  async function changeStatus(id: string, status: JobOpening["status"]) {
    setError(null);
    try {
      await setJobOpeningStatus(id, status);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible.");
    }
  }

  return (
    <Card
      title="Recrutement"
      subtitle="Postes à pourvoir et candidatures reçues."
      action={canManage ? <Button variant="add" size="sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Fermer" : "+ Poste"}</Button> : undefined}
    >
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {showForm && canManage && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            <Field label="Intitulé du poste"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex. Correcteur bilingue" /></Field>
            <Field label="Département">
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">—</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Type de contrat">
              <select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
                <option value="">—</option>
                <option value="cdi">CDI</option>
                <option value="cdd">CDD</option>
                <option value="stage">Stage</option>
                <option value="prestation">Prestation</option>
              </select>
            </Field>
          </div>
          <div style={{ marginTop: 8 }}><Field label="Description (missions, profil recherché)"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <Button variant="add" size="sm" type="button" disabled={form.title.trim().length < 2} onClick={submitOpening}>Ouvrir le poste</Button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "4px 0 12px" }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Toutes les candidatures :</span>
        <select value={printStatus} onChange={(e) => setPrintStatus(e.target.value)} style={{ padding: "6px 9px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "var(--card)", color: "var(--ink)" }}>
          <option value="">Tous les statuts</option>
          <option value="recue">Reçue</option>
          <option value="entretien">Entretien</option>
          <option value="retenue">Retenue</option>
          <option value="refusee">Refusée</option>
        </select>
        <Button variant="view" size="sm" disabled={printingAll} onClick={printAll}>{printingAll ? "Préparation…" : "🖨 Imprimer toutes les candidatures"}</Button>
      </div>

      {openings.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun poste ouvert.</p>}

      <div className="ecl-list">
        {openings.map((o) => (
          <div key={o.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{o.title} <Chip s={OPENING_STATUS_LABEL[o.status]} /></div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {o.department ?? "Sans département"}{o.contract_type ? ` · ${o.contract_type.toUpperCase()}` : ""} · ouvert le <span style={{ fontFamily: "var(--font-mono)" }}>{o.opened_at.slice(0, 10)}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {o.applications_total} cand. · {o.applications_by_status.retenue} retenue(s)
                </span>
                <Button variant="view" size="sm" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>{expanded === o.id ? "Masquer" : "Candidatures"}</Button>
                {canValidate && o.status === "ouvert" && (
                  <>
                    <Button variant="edit" size="sm" onClick={() => changeStatus(o.id, "pourvu")}>Pourvu</Button>
                    <Button variant="danger" size="sm" onClick={() => changeStatus(o.id, "annule")}>Annuler</Button>
                  </>
                )}
                {canValidate && o.status !== "ouvert" && <Button variant="subtle" size="sm" onClick={() => changeStatus(o.id, "ouvert")}>Rouvrir</Button>}
              </div>
            </div>
            {expanded === o.id && <ApplicationsPanel openingId={o.id} openingTitle={o.title} department={o.department ?? null} canManage={canManage} onChanged={load} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ApplicationsPanel({ openingId, openingTitle, department, canManage, onChanged }: { openingId: string; openingTitle: string; department: string | null; canManage: boolean; onChanged: () => void }) {
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", source: "", notes: "" });

  const load = () => getJobApplications(openingId).then(setApps).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [openingId]);

  async function submit() {
    setError(null);
    try {
      await createJobApplication(openingId, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        source: form.source.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({ first_name: "", last_name: "", email: "", phone: "", source: "", notes: "" });
      setShowForm(false);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  async function advance(id: string, status: JobApplicationStatus) {
    setError(null);
    try {
      await setJobApplicationStatus(id, status);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible.");
    }
  }

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canManage && <Button variant="add" size="sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Fermer" : "+ Candidature"}</Button>}
        <Button variant="view" size="sm" disabled={apps.length === 0} onClick={() => printJobApplications({ openingTitle, department, apps })}>🖨 Imprimer la liste</Button>
      </div>
      {showForm && canManage && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <Field label="Prénom"><input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
            <Field label="Nom"><input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
            <Field label="E-mail"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Téléphone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Source"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Spontanée, annonce…" /></Field>
          </div>
          <div style={{ marginTop: 8 }}><Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button variant="add" size="sm" type="button" disabled={!form.first_name.trim() || !form.last_name.trim()} onClick={submit}>Enregistrer</Button>
          </div>
        </div>
      )}
      {apps.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0 }}>Aucune candidature.</p>}
      <div style={{ display: "grid", gap: 6 }}>
        {apps.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline", padding: "6px 0" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.firstName} {a.lastName} <Chip s={APP_STATUS_LABEL[a.status]} /></div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {[a.email, a.phone, a.source].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            {canManage && a.status !== "retenue" && a.status !== "refusee" && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {a.status === "recue" && <Button variant="view" size="sm" onClick={() => advance(a.id, "entretien")}>Entretien</Button>}
                <Button variant="edit" size="sm" onClick={() => advance(a.id, "retenue")}>Retenir</Button>
                <Button variant="danger" size="sm" onClick={() => advance(a.id, "refusee")}>Refuser</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
