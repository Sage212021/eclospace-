import { useEffect, useState } from "react";
import { cancelReadingAssignment, listManuscriptReadingAssignments, readingReportFileUrl, type ReadingAssignment } from "../api/client";
import { printReadingReport } from "../lib/print";
import { buildReadingReport } from "../lib/readingReport";
import { DocPrintMenu } from "./DocPrintMenu";
import { useConfirm } from "./ConfirmProvider";

// Comité de lecture / Direction : lecture et téléchargement des rapports des
// relecteurs d'un manuscrit — le rapport généré (évaluation) et le fichier joint.

const RECO_SHORT: Record<string, string> = {
  accept: "Acceptation",
  accept_minor: "Corrections mineures",
  accept_major: "Corrections majeures",
  rewrite: "Réécriture",
  new_expertise: "Nouvelle expertise",
  reject: "Refus motivé",
};

export function ReadingEvaluationsSection({
  manuscriptId,
  canManage = false,
  onChanged,
}: {
  manuscriptId: string;
  // Responsable du comité (comite_lecture:saisie) : peut retirer une mission.
  canManage?: boolean;
  // Notifie le parent (ex. pour rafraîchir l'étape si le retrait transmet le
  // dossier à la décision éditoriale).
  onChanged?: () => void;
}) {
  const confirm = useConfirm();
  const [items, setItems] = useState<ReadingAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listManuscriptReadingAssignments(manuscriptId)
      .then(setItems)
      .catch(() => setItems([]));

  useEffect(() => {
    load();
  }, [manuscriptId]);

  async function handleCancel(a: ReadingAssignment) {
    const ok = await confirm({
      title: "Retirer la mission",
      message: `Retirer la mission de lecture de ${a.reader?.username ?? "ce relecteur"} ?`,
      detail: "La mission (non encore évaluée) sera annulée. Utile pour corriger une affectation erronée ou un doublon.",
      tone: "danger",
      confirmLabel: "Retirer",
    });
    if (!ok) return;
    setError(null);
    try {
      await cancelReadingAssignment(a.id);
      await load();
      // Rafraîchit le parent (l'étape a pu avancer si c'était la dernière
      // mission en attente et qu'un rapport avait été remis).
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrait impossible.");
    }
  }

  // On masque les missions annulées (elles ne concernent plus le comité).
  const visible = (items ?? []).filter((a) => a.status !== "cancelled");
  if (!items || visible.length === 0) return null;

  return (
    <section className="ecl-card">
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>Comité de lecture — rapports</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>Les évaluations des relecteurs et leurs rapports.</p>
      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map((a) => (
          <div
            key={a.id}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "10px 12px",
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, fontSize: 13.5 }}>
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>{a.reader?.username ?? "—"}</span>
              {a.evaluation ? (
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                  {RECO_SHORT[a.evaluation.recommendation] ?? a.evaluation.recommendation} ·{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>{Number(a.evaluation.globalScore)} / 10</span>
                </span>
              ) : (
                <span style={{ color: "var(--muted)", marginLeft: 8, fontStyle: "italic" }}>évaluation en attente</span>
              )}
              {a.conflictDeclaredAt && (
                a.conflictHasConflict ? (
                  <div style={{ marginTop: 3, fontSize: 11.5, color: "#C4661F" }}>
                    ⚠ Conflit d'intérêt signalé{a.conflictDetails ? ` : ${a.conflictDetails}` : ""}
                  </div>
                ) : (
                  <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--muted)" }}>✓ Aucun conflit d'intérêt déclaré</div>
                )
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {a.evaluation && (
                <DocPrintMenu label="Télécharger le rapport" onPrint={(opts) => printReadingReport(buildReadingReport(a), opts)} />
              )}
              {a.hasReportFile && (
                <a
                  href={readingReportFileUrl(a.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--eclosion-dark)", fontWeight: 600, fontSize: 12.5 }}
                >
                  📎 {a.reportFileName ?? "fichier joint"}
                </a>
              )}
              {canManage && !a.evaluation && (
                <button
                  onClick={() => handleCancel(a)}
                  title="Retirer cette mission (affectation erronée ou doublon)"
                  style={{ background: "#fff", color: "var(--alert)", border: "1px solid var(--alert)", borderRadius: 8, padding: "5px 10px", fontSize: 12.5, cursor: "pointer" }}
                >
                  Retirer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
