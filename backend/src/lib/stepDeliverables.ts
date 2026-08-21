import { prisma } from "./prisma.js";

// Verrou « livrable de sortie » (demande opérateur 20/08/2026) : certaines
// étapes produisent un fichier qui sert d'entrée à l'étape suivante (maquette,
// couverture, rapport d'expertise, version réécrite, fiche de planification…).
// On refuse alors d'avancer tant que ce livrable n'est pas déposé — pour qu'un
// manuscrit n'arrive jamais à l'étape suivante « les mains vides ».
//
// La LISTE des étapes soumises à ce verrou est un paramètre modifiable
// (clé settings « workflow_deliverable_steps »), avec une valeur par défaut.

// Par défaut, le verrou couvre les étapes éditoriales qui remettent un fichier
// distinct à l'étape suivante. Mise en page & Infographie ont déjà un verrou
// métier propre (fiche technique, convergence) ; l'administrateur peut les
// ajouter au verrou fichier depuis les Paramètres si besoin.
export const DEFAULT_DELIVERABLE_STEPS = ["PLANIFICATION", "EXPERTISE", "REECRITURE"];

// Libellé du livrable attendu par étape (aide à l'écran ; purement informatif).
export const DELIVERABLE_LABELS: Record<string, string> = {
  PLANIFICATION: "Fiche de lancement / planning du projet",
  EXPERTISE: "Rapport d'expertise scientifique",
  REECRITURE: "Version réécrite du manuscrit",
  MISE_EN_PAGE: "Maquette mise en page",
  INFOGRAPHIE: "Couverture / éléments graphiques",
  CORRECTION: "Rapport de correction + version finale",
};

const SETTINGS_KEY = "workflow_deliverable_steps";
const TITLE_PREFIX = "[livrable:";

export function deliverableDocTitle(stepCode: string, filename: string): string {
  return `${TITLE_PREFIX}${stepCode}] ${filename}`.slice(0, 200);
}

// Étapes actuellement soumises au verrou (paramètre, repli sur le défaut).
export async function deliverableRequiredSteps(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const value = row?.value as unknown;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return DEFAULT_DELIVERABLE_STEPS;
}

export async function isDeliverableRequired(stepCode: string): Promise<boolean> {
  return (await deliverableRequiredSteps()).includes(stepCode);
}

// Le livrable de l'étape est-il déposé ? (document « pièce d'étape » au titre
// stable « [livrable:CODE] … », avec au moins une version).
export async function hasStepDeliverable(manuscriptId: string, stepCode: string): Promise<boolean> {
  const doc = await prisma.document.findFirst({
    where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", deletedAt: null, title: { startsWith: `${TITLE_PREFIX}${stepCode}]` } },
    select: { versions: { select: { id: true }, take: 1 } },
  });
  return Boolean(doc && doc.versions.length > 0);
}

// Métadonnée du livrable d'une étape (présence + dernier fichier téléchargeable).
export async function stepDeliverableMeta(manuscriptId: string, stepCode: string) {
  const doc = await prisma.document.findFirst({
    where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", deletedAt: null, title: { startsWith: `${TITLE_PREFIX}${stepCode}]` } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true, createdBy: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } },
  });
  const v = doc?.versions[0];
  return {
    step_code: stepCode,
    required: await isDeliverableRequired(stepCode),
    label: DELIVERABLE_LABELS[stepCode] ?? "Livrable de l'étape",
    has_file: Boolean(v),
    doc_id: doc?.id ?? null,
    uploaded_by: doc?.createdBy ?? null,
    version_id: v?.id ?? null,
    filename: doc ? doc.title.replace(/^\[livrable:[A-Z_]+\]\s*/, "") : null,
    created_at: doc?.createdAt ?? null,
  };
}
