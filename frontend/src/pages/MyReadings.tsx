import { useEffect, useState } from "react";
import {
  listEvaluationCriteria,
  listMyReadingAssignments,
  submitEvaluation,
  type EvaluationCriterion,
  type ReadingAssignment,
} from "../api/client";

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
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20 }}>Mes lectures</h1>
      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
          {message}
        </div>
      )}
      {assignments.length === 0 && (
        <p style={{ color: "var(--muted)" }}>Aucune mission en cours — les nouvelles affectations apparaîtront ici.</p>
      )}
      {assignments.map((assignment) => (
        <div key={assignment.id} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{assignment.manuscript?.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Échéance : {new Date(assignment.dueAt).toLocaleDateString("fr-FR")} · Statut : {assignment.status}
              </div>
            </div>
            {assignment.status === "pending" && (
              <button
                onClick={() => setOpenAssignmentId(openAssignmentId === assignment.id ? null : assignment.id)}
                style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
              >
                Évaluer
              </button>
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
        </div>
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
    <form onSubmit={handleSubmit} style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      {criteria.map((criterion) => (
        <div key={criterion.id} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span>
              {criterion.label} <span style={{ color: "var(--muted)" }}>(coef. {criterion.coefficient})</span>
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{scores[criterion.id] ?? 0}/10</span>
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

      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        Score global indicatif (recalculé et validé par le serveur à la remise) :{" "}
        <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{livePreview.toFixed(2)}</strong>
      </div>

      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Recommandation
        <select value={recommendation} onChange={(e) => setRecommendation(e.target.value as typeof recommendation)} style={{ display: "block", padding: 6, marginTop: 4 }}>
          <option value="accept">Acceptation sans modification</option>
          <option value="accept_minor">Acceptation sous réserve de corrections mineures</option>
          <option value="accept_major">Acceptation sous réserve de corrections majeures</option>
          <option value="rewrite">Demande de réécriture</option>
          <option value="new_expertise">Nouvelle expertise</option>
          <option value="reject">Refus motivé</option>
        </select>
      </label>

      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Appréciation générale
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4, fontFamily: "inherit", fontSize: 13 }}
        />
      </label>

      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      <button
        type="submit"
        style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
      >
        Remettre mon rapport
      </button>
    </form>
  );
}
