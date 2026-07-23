import { useEffect, useState } from "react";
import {
  listEvaluationCriteria,
  listMyReadingAssignments,
  submitEvaluation,
  uploadReadingReportFile,
  readingReportFileUrl,
  type EvaluationCriterion,
  type ReadingAssignment,
} from "../api/client";
import { Button } from "../components/Button";
import { DocPrintMenu } from "../components/DocPrintMenu";
import { Field } from "../components/Modal";
import { printReadingReport } from "../lib/print";
import { buildReadingReport } from "../lib/readingReport";

const STATUS_LABELS: Record<string, string> = {
  pending: "À évaluer",
  submitted: "Remise",
  cancelled: "Annulée",
};

// Vue lecteur du comité de lecture (Ch. 7 §7.3) : missions attribuées et
// formulaire de notation pondérée (Ch. 7 §7.4-7.5).
import { useI18n } from "../i18n";

export function MyReadings() {
  const { t, lang } = useI18n();
  const [assignments, setAssignments] = useState<ReadingAssignment[]>([]);
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => listMyReadingAssignments().then(setAssignments);

  useEffect(() => {
    refresh();
  }, []);

  async function attachFile(assignmentId: string, file: File) {
    try {
      await uploadReadingReportFile(assignmentId, file);
      setMessage(t("myr.file_attached_ok", "Rapport de relecture (fichier) joint."));
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Dépôt du fichier impossible.");
    }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 680 }}>
      <h1 className="ecl-page__title">{t("page.myreadings.title", "Mes lectures")}</h1>
      <p className="ecl-page__lead">{t("page.myreadings.lead", "Vos missions de lecture et la remise de vos évaluations.")}</p>

      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}
      {assignments.length === 0 && (
        <p style={{ color: "var(--muted)", marginTop: 16 }}>{t("myr.empty", "Aucune mission en cours — les nouvelles affectations apparaîtront ici.")}</p>
      )}
      {assignments.map((assignment) => (
        <section key={assignment.id} className="ecl-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)" }}>{assignment.manuscript?.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span>{t("myr.deadline", "Échéance")} : {new Date(assignment.dueAt).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")}</span>
                <StatusChip label={t(`myr.status.${assignment.status}`, STATUS_LABELS[assignment.status] ?? assignment.status)} />
              </div>
            </div>
            {assignment.status === "pending" && (
              <Button
                variant={openAssignmentId === assignment.id ? "view" : "add"}
                size="sm"
                onClick={() => setOpenAssignmentId(openAssignmentId === assignment.id ? null : assignment.id)}
              >
                {openAssignmentId === assignment.id ? t("myr.close", "Fermer") : t("myr.evaluate", "Évaluer")}
              </Button>
            )}
            {assignment.evaluation && (
              <DocPrintMenu
                label={t("myr.download_report", "Télécharger mon rapport")}
                onPrint={(opts) => printReadingReport(buildReadingReport(assignment), opts)}
              />
            )}
          </div>

          {/* Fichier externe de rapport de relecture : joindre le document rédigé. */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 12.5 }}>
            <label style={fileBtnStyle}>
              {assignment.hasReportFile ? t("myr.file_replace", "Remplacer le fichier joint") : t("myr.file_attach", "Joindre le rapport (fichier)")}
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attachFile(assignment.id, f);
                  e.target.value = "";
                }}
              />
            </label>
            {assignment.hasReportFile && (
              <a href={readingReportFileUrl(assignment.id)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
                📎 {assignment.reportFileName ?? t("myr.file_download", "Télécharger le fichier joint")}
              </a>
            )}
          </div>
          {openAssignmentId === assignment.id && (
            <EvaluationForm
              assignmentId={assignment.id}
              onSubmitted={() => {
                setOpenAssignmentId(null);
                setMessage(t("myr.submitted_ok", "Évaluation remise avec succès."));
                refresh();
              }}
            />
          )}
        </section>
      ))}
    </div>
  );
}

function EvaluationForm({ assignmentId, onSubmitted }: { assignmentId: string; onSubmitted: () => void }) {
  const { t } = useI18n();
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [recommendation, setRecommendation] = useState<"accept" | "accept_minor" | "accept_major" | "rewrite" | "new_expertise" | "reject">("accept");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listEvaluationCriteria().then((c) => {
      setCriteria(c);
      setScores(Object.fromEntries(c.map((crit) => [crit.id, 5])));
    });
  }, []);

  const totalCoefficient = criteria.reduce((sum, c) => sum + Number(c.coefficient), 0);
  const livePreview =
    totalCoefficient > 0
      ? criteria.reduce((sum, c) => sum + (scores[c.id] ?? 0) * Number(c.coefficient), 0) / totalCoefficient
      : 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await submitEvaluation(assignmentId, {
        scores: criteria.map((c) => ({ criterion_id: c.id, score: scores[c.id] ?? 0 })),
        overall_comment: comment,
        recommendation,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la remise.");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      {criteria.map((criterion) => (
        <div key={criterion.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>
              {criterion.label} <span style={{ color: "var(--muted)" }}>({t("myr.coef", "coef.")} {criterion.coefficient})</span>
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{scores[criterion.id] ?? 0}/10</span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={scores[criterion.id] ?? 5}
            onChange={(e) => setScores((s) => ({ ...s, [criterion.id]: Number(e.target.value) }))}
            style={{ width: "100%", accentColor: "var(--eclosion)" }}
          />
        </div>
      ))}

      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 14px", padding: "8px 12px", background: "var(--paper)", borderRadius: 8 }}>
        {t("myr.global_score", "Score global indicatif (recalculé et validé par le serveur à la remise) :")}{" "}
        <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{livePreview.toFixed(2)}</strong>
      </div>

      <Field label={t("myr.recommendation", "Recommandation")}>
        <select value={recommendation} onChange={(e) => setRecommendation(e.target.value as typeof recommendation)}>
          <option value="accept">{t("myr.reco.accept", "Acceptation sans modification")}</option>
          <option value="accept_minor">{t("myr.reco.accept_minor", "Acceptation sous réserve de corrections mineures")}</option>
          <option value="accept_major">{t("myr.reco.accept_major", "Acceptation sous réserve de corrections majeures")}</option>
          <option value="rewrite">{t("myr.reco.rewrite", "Demande de réécriture")}</option>
          <option value="new_expertise">{t("myr.reco.new_expertise", "Nouvelle expertise")}</option>
          <option value="reject">{t("myr.reco.reject", "Refus motivé")}</option>
        </select>
      </Field>

      <div style={{ marginTop: 12 }}>
        <Field label={t("myr.general_comment", "Appréciation générale")}>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </Field>
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 12.5, marginTop: 10 }}>{error}</p>}

      <div style={{ marginTop: 14 }}>
        <Button variant="add" size="md" type="submit">{t("myr.submit_report", "Remettre mon rapport")}</Button>
      </div>
    </form>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

const fileBtnStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "4px 10px",
};
