import { type ReadingReportData } from "./print";
import { type ReadingAssignment } from "../api/client";

// Construit le rapport imprimable à partir d'une évaluation remise. Partagé
// entre « Mes lectures » (le relecteur) et la fiche manuscrit (comité/direction).
export function buildReadingReport(a: ReadingAssignment): ReadingReportData {
  const e = a.evaluation!;
  return {
    manuscriptTitle: a.manuscript?.title ?? "—",
    manuscriptNumber: a.manuscript?.manuscriptNumber ?? "—",
    readerName: a.reader?.username ?? "—",
    submittedAt: e.submittedAt,
    recommendation: e.recommendation,
    globalScore: Number(e.globalScore),
    overallComment: e.overallComment,
    scores: e.scores.map((s) => ({
      label: s.criterion.label,
      coefficient: Number(s.criterion.coefficient),
      score: Number(s.score),
      comment: s.comment,
    })),
  };
}
