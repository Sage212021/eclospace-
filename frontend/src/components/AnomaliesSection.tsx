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
import { useI18n } from "../i18n";

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
  if (s === "validee" || s === "corrigee") return "var(--eclosion, #d9b21a)";
  if (s === "rejetee") return "var(--danger, #C24B3A)";
  if (s === "en_attente") return "var(--retard, #C4661F)";
  return "var(--muted)";
}

export function AnomaliesSection({ canValidate, employees }: { canValidate: boolean; employees: Employee[] }) {
  const { t, lang } = useI18n();
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
      setMessage(
        lang === "en"
          ? `Scan complete: ${r.created} anomaly(ies) created out of ${r.detected} detected.`
          : `Scan effectué : ${r.created} anomalie(s) créée(s) sur ${r.detected} détectée(s).`,
      );
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
      setMessage(t("att.msg.justif_saved", "Justificatif enregistré."));
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Justification impossible.");
    }
  }

  async function decide(id: string, action: "valider" | "rejeter") {
    try {
      await decideAnomaly(id, { action });
      setMessage(action === "valider" ? t("att.msg.anomaly_validated", "Anomalie validée.") : t("att.msg.anomaly_rejected", "Anomalie rejetée."));
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Décision impossible.");
    }
  }

  return (
    <Card
      title={t("att.anomalies", "Anomalies de présence")}
      icon={<IconAdmin />}
      subtitle={t("att.anomalies_sub", "Retards, départs anticipés et absences à justifier puis valider avant la paie.")}
      action={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">{t("att.all_statuses", "Tous les statuts")}</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{t("att.ast." + v, l)}</option>)}
        </select>
      }
    >
      {canValidate && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, marginBottom: 12 }}>
          <Field label={t("att.scan_employee", "Scanner un employé (mois courant)")}>
            <select value={scanEmp} onChange={(e) => setScanEmp(e.target.value)}>
              <option value="">{t("att.choose", "— Choisir —")}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </Field>
          <Button variant="edit" size="sm" type="button" onClick={runScan}>{t("att.scan", "Scanner")}</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("att.no_anomaly", "Aucune anomalie.")}</p>
      ) : (
        <div className="ecl-list">
          {rows.map((a) => (
            <div key={a.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
              <div className="ecl-row__main">
                <div className="ecl-row__title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{a.day}</span>
                  {t("att.type." + a.type, TYPE_LABELS[a.type] ?? a.type)}
                  {a.minutes != null && <span style={{ color: "var(--muted)" }}>· {a.minutes} {t("att.min", "min")}</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, color: statusColor(a.status) }}>{t("att.ast." + a.status, STATUS_LABELS[a.status])}</span>
                </div>
                <div className="ecl-row__desc">
                  {a.employee_name ? `${a.employee_name} · ` : ""}{a.detail}
                  {a.justification_motif && <span> · {t("att.motif_prefix", "Motif :")} {a.justification_motif}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {a.status !== "validee" && a.status !== "annulee" && (
                  <Button variant="view" size="sm" type="button" onClick={() => { setJustifying(justifying === a.id ? null : a.id); setMotif(MOTIFS[0]); }}>{t("att.justify", "Justifier")}</Button>
                )}
                {canValidate && a.status !== "validee" && a.status !== "annulee" && (
                  <>
                    <Button variant="add" size="sm" type="button" onClick={() => decide(a.id, "valider")}>{t("att.validate", "Valider")}</Button>
                    <Button variant="danger" size="sm" type="button" onClick={() => decide(a.id, "rejeter")}>{t("att.reject", "Rejeter")}</Button>
                  </>
                )}
              </div>
              {justifying === a.id && (
                <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, marginTop: 6 }}>
                  <Field label={t("att.motif_field", "Motif")}>
                    <select value={motif} onChange={(e) => setMotif(e.target.value)}>
                      {MOTIFS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label={t("att.comment_opt", "Commentaire (optionnel)")}>
                    <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("att.comment_ph", "Précision…")} />
                  </Field>
                  <Button variant="add" size="sm" type="button" onClick={() => submitJustify(a.id)}>{t("att.send", "Envoyer")}</Button>
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
