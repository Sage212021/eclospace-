import { useEffect, useState } from "react";
import {
  decideAnomaly,
  justifyAnomaly,
  listAnomalies,
  scanAnomalies,
  type AttendanceAnomaly,
  type AnomalyStatus,
  type Employee,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// File de traitement des anomalies de présence (§19, §23-25). Employé : justifie
// les siennes. Validateur (chef/RH/DG) : scanne, valide, rejette.

const TYPE_LABELS: Record<string, string> = {
  retard: "Retard",
  depart_anticipe: "Départ anticipé",
  absence: "Absence",
  incoherence: "Incohérence",
  absence_connexion: "Absence de connexion",
  absence_deconnexion: "Absence de déconnexion",
  duree_anormale: "Durée anormale",
};

const STATUS_LABELS: Record<AnomalyStatus, string> = {
  en_attente: "En attente",
  en_analyse: "En analyse",
  validee: "Validée",
  rejetee: "Rejetée",
  corrigee: "Corrigée",
  annulee: "Annulée",
};

const MOTIFS = ["Mission", "Autorisation exceptionnelle", "Congé", "Permission", "Maladie", "Formation", "Déplacement professionnel", "Panne informatique", "Panne Internet", "Cas de force majeure", "Autre"];

function statusColor(s: AnomalyStatus): string {
  if (s === "validee" || s === "corrigee") return "var(--eclosion, #C89A1B)";
  if (s === "rejetee") return "var(--danger, #C24B3A)";
  if (s === "en_attente") return "var(--retard, #C4661F)";
  return "var(--muted)";
}

export function AnomaliesSection({ canValidate, employees }: { canValidate: boolean; employees: Employee[] }) {
  const [rows, setRows] = useState<AttendanceAnomaly[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scanEmp, setScanEmp] = useState("");
  const [justifying, setJustifying] = useState<string | null>(null);
  const [motif, setMotif] = useState(MOTIFS[0]);
  const [comment, setComment] = useState("");

  async function refresh() {
    try {
      setRows(await listAnomalies(status ? { status } : undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement des anomalies impossible.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function runScan() {
    if (!scanEmp) return;
    try {
      const r = await scanAnomalies({ employee_id: scanEmp });
      setMessage(`Scan effectué : ${r.created} anomalie(s) créée(s) sur ${r.detected} détectée(s).`);
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan impossible.");
    }
  }

  async function submitJustify(id: string) {
    try {
      await justifyAnomaly(id, { motif, comment: comment.trim() || undefined });
      setJustifying(null);
      setComment("");
      setMessage("Justificatif enregistré.");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Justification impossible.");
    }
  }

  async function decide(id: string, action: "valider" | "rejeter") {
    try {
      await decideAnomaly(id, { action });
      setMessage(action === "valider" ? "Anomalie validée." : "Anomalie rejetée.");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Décision impossible.");
    }
  }

  return (
    <Card
      title="Anomalies de présence"
      icon={<IconAdmin />}
      subtitle="Retards, départs anticipés et absences à justifier puis valider avant la paie."
      action={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      }
    >
      {canValidate && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, marginBottom: 12 }}>
          <Field label="Scanner un employé (mois courant)">
            <select value={scanEmp} onChange={(e) => setScanEmp(e.target.value)}>
              <option value="">— Choisir —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </Field>
          <Button variant="edit" size="sm" type="button" onClick={runScan}>Scanner</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune anomalie.</p>
      ) : (
        <div className="ecl-list">
          {rows.map((a) => (
            <div key={a.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
              <div className="ecl-row__main">
                <div className="ecl-row__title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{a.day}</span>
                  {TYPE_LABELS[a.type] ?? a.type}
                  {a.minutes != null && <span style={{ color: "var(--muted)" }}>· {a.minutes} min</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, color: statusColor(a.status) }}>{STATUS_LABELS[a.status]}</span>
                </div>
                <div className="ecl-row__desc">
                  {a.employee_name ? `${a.employee_name} · ` : ""}{a.detail}
                  {a.justification_motif && <span> · Motif : {a.justification_motif}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {a.status !== "validee" && a.status !== "annulee" && (
                  <Button variant="view" size="sm" type="button" onClick={() => { setJustifying(justifying === a.id ? null : a.id); setMotif(MOTIFS[0]); }}>Justifier</Button>
                )}
                {canValidate && a.status !== "validee" && a.status !== "annulee" && (
                  <>
                    <Button variant="add" size="sm" type="button" onClick={() => decide(a.id, "valider")}>Valider</Button>
                    <Button variant="danger" size="sm" type="button" onClick={() => decide(a.id, "rejeter")}>Rejeter</Button>
                  </>
                )}
              </div>
              {justifying === a.id && (
                <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, marginTop: 6 }}>
                  <Field label="Motif">
                    <select value={motif} onChange={(e) => setMotif(e.target.value)}>
                      {MOTIFS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="Commentaire (optionnel)">
                    <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Précision…" />
                  </Field>
                  <Button variant="add" size="sm" type="button" onClick={() => submitJustify(a.id)}>Envoyer</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
