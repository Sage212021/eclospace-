import { type ReadingReportData } from "./print";
import { type ReadingAssignment } from "../api/client";
import { tidyProse, tidyReadingAppreciation } from "./tidyProse";

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
    recommendationNote: e.recommendationNote ?? null,
    globalScore: Number(e.globalScore),
    // Remise en forme des textes collés « à plat » (retours à la ligne perdus,
    // phrases/intertitres soudés) — sans effet sur un texte déjà propre.
    overallComment: tidyReadingAppreciation(e.overallComment),
    scores: e.scores.map((s) => ({
      label: s.criterion.label,
      coefficient: Number(s.criterion.coefficient),
      score: Number(s.score),
      comment: tidyProse(s.comment) || null,
    })),
  };
}
