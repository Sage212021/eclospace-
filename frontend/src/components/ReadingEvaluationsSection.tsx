import { useEffect, useState } from "react";
import { listManuscriptReadingAssignments, readingReportFileUrl, type ReadingAssignment } from "../api/client";
import { printReadingReport } from "../lib/print";
import { buildReadingReport } from "../lib/readingReport";
import { DocPrintMenu } from "./DocPrintMenu";

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

export function ReadingEvaluationsSection({ manuscriptId }: { manuscriptId: string }) {
  const [items, setItems] = useState<ReadingAssignment[] | null>(null);

  useEffect(() => {
    listManuscriptReadingAssignments(manuscriptId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [manuscriptId]);

  if (!items || items.length === 0) return null;

  return (
    <section className="ecl-card">
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>Comité de lecture — rapports</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>Les évaluations des relecteurs et leurs rapports.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((a) => (
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
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
