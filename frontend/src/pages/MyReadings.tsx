import { useEffect, useState } from "react";
import {
  listEvaluationCriteria,
  listMyReadingAssignments,
  submitEvaluation,
  type EvaluationCriterion,
  type ReadingAssignment,
} from "../api/client";
import { Button } from "../components/Button";
import { Field } from "../components/Modal";

const STATUS_LABELS: Record<string, string> = {
  pending: "À évaluer",
  submitted: "Remise",
  cancelled: "Annulée",
};

// Vue lecteur du comité de lecture (Ch. 7 §7.3) : missions attribuées et
// formulaire de notation pondérée (Ch. 7 §7.4-7.5).
export function MyReadings() {
  const [assignments, setAssignments] = useState<ReadingAssignment[]>([]);
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => listMyReadingAssignments().then(setAssignments);

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="ecl-page" style={{ maxWidth: 680 }}>
      <h1 className="ecl-page__title">Mes lectures</h1>
      <p className="ecl-page__lead">Vos missions de lecture et la remise de vos évaluations.</p>

      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}
      {assignments.length === 0 && (
        <p style={{ color: "var(--muted)", marginTop: 16 }}>Aucune mission en cours — les nouvelles affectations apparaîtront ici.</p>
      )}
      {assignments.map((assignment) => (
        <section key={assignment.id} className="ecl-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)" }}>{assignment.manuscript?.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span>Échéance : {new Date(assignment.dueAt).toLocaleDateString("fr-FR")}</span>
                <StatusChip label={STATUS_LABELS[assignment.status] ?? assignment.status} />
              </div>
            </div>
            {assignment.status === "pending" && (
              <Button
                variant={openAssignmentId === assignment.id ? "view" : "add"}
                size="sm"
                onClick={() => setOpenAssignmentId(openAssignmentId === assignment.id ? null : assignment.id)}
              >
                {openAssignmentId === assignment.id ? "Fermer" : "Évaluer"}
              </Button>
            )}
          </div>
          {openAssignmentId === assignment.id && (
            <EvaluationForm
              assignmentId={assignment.id}
              onSubmitted={() => {
                setOpenAssignmentId(null);
                setMessage("Évaluation remise avec succès.");
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
              {criterion.label} <span style={{ color: "var(--muted)" }}>(coef. {criterion.coefficient})</span>
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
        Score global indicatif (recalculé et validé par le serveur à la remise) :{" "}
        <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{livePreview.toFixed(2)}</strong>
      </div>

      <Field label="Recommandation">
        <select value={recommendation} onChange={(e) => setRecommendation(e.target.value as typeof recommendation)}>
          <option value="accept">Acceptation sans modification</option>
          <option value="accept_minor">Acceptation sous réserve de corrections mineures</option>
          <option value="accept_major">Acceptation sous réserve de corrections majeures</option>
          <option value="rewrite">Demande de réécriture</option>
          <option value="new_expertise">Nouvelle expertise</option>
          <option value="reject">Refus motivé</option>
        </select>
      </Field>

      <div style={{ marginTop: 12 }}>
        <Field label="Appréciation générale">
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </Field>
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 12.5, marginTop: 10 }}>{error}</p>}

      <div style={{ marginTop: 14 }}>
        <Button variant="add" size="md" type="submit">Remettre mon rapport</Button>
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
