import { prisma } from "./prisma.js";

// Étapes « à option » (demande opérateur 20/08/2026) : Expertise scientifique,
// Réécriture éditoriale et Projet (Planification) ne sont pas toujours
// nécessaires. À ces étapes, l'opérateur choisit explicitement :
//   • RÉALISER l'étape — il renseigne alors les éléments attendus, puis valide ;
//   • PASSER l'étape (si elle est déclarée « facultative ») — avec un motif.
//
// Le caractère « facultative » (on peut passer) ou « obligatoire » (on doit
// réaliser) de chaque étape est défini à l'AVANCE dans les Paramètres
// (clé settings « workflow_step_modes »), avec des valeurs par défaut.

export const OPTIONAL_DECISION_STEPS = ["EXPERTISE", "REECRITURE", "PLANIFICATION"] as const;
export type OptionalStepCode = (typeof OPTIONAL_DECISION_STEPS)[number];

export type StepMode = "facultative" | "obligatoire";

// Par défaut : l'expertise et la réécriture sont facultatives (souvent inutiles) ;
// le projet (planification) est obligatoire (tout ouvrage édité se planifie).
export const DEFAULT_STEP_MODES: Record<OptionalStepCode, StepMode> = {
  EXPERTISE: "facultative",
  REECRITURE: "facultative",
  PLANIFICATION: "obligatoire",
};

export const OPTIONAL_STEP_LABELS: Record<OptionalStepCode, string> = {
  EXPERTISE: "Expertise scientifique",
  REECRITURE: "Réécriture éditoriale",
  PLANIFICATION: "Projet (planification)",
};

const SETTINGS_KEY = "workflow_step_modes";

export function isOptionalDecisionStep(code: string): code is OptionalStepCode {
  return (OPTIONAL_DECISION_STEPS as readonly string[]).includes(code);
}

// Modes courants (paramètre, repli sur le défaut clé par clé).
export async function stepModes(): Promise<Record<OptionalStepCode, StepMode>> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_STEP_MODES };
  for (const code of OPTIONAL_DECISION_STEPS) {
    if (value[code] === "facultative" || value[code] === "obligatoire") out[code] = value[code] as StepMode;
  }
  return out;
}

export async function stepMode(code: OptionalStepCode): Promise<StepMode> {
  return (await stepModes())[code];
}

// Éléments à renseigner quand l'étape est RÉALISÉE. On les décrit ici pour
// piloter à la fois la validation backend et l'affichage du formulaire.
export interface RealizationField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  required: boolean;
  options?: { value: string; label: string }[];
}

export const REALIZATION_FIELDS: Record<OptionalStepCode, RealizationField[]> = {
  EXPERTISE: [
    { key: "expert_name", label: "Expert désigné", type: "text", required: true },
    {
      key: "expert_opinion",
      label: "Avis de l'expert",
      type: "select",
      required: true,
      options: [
        { value: "favorable", label: "Favorable" },
        { value: "reserves", label: "Favorable avec réserves" },
        { value: "defavorable", label: "Défavorable" },
      ],
    },
  ],
  REECRITURE: [{ key: "note", label: "Note de réécriture (consignes / résumé des changements)", type: "textarea", required: true }],
  PLANIFICATION: [
    { key: "responsible_name", label: "Responsable du projet", type: "text", required: true },
    { key: "schedule", label: "Calendrier prévisionnel (jalons clés)", type: "textarea", required: true },
    { key: "budget", label: "Budget prévisionnel (XAF)", type: "number", required: false },
  ],
};

// Contrôle des éléments renseignés à la réalisation : renvoie la liste des
// libellés manquants (vide = complet). N'inclut PAS le fichier livrable, géré
// séparément par le verrou « livrable de sortie » (lib stepDeliverables).
export function missingRealizationFields(code: OptionalStepCode, data: Record<string, unknown> | null | undefined): string[] {
  const fields = REALIZATION_FIELDS[code] ?? [];
  const d = data ?? {};
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const v = d[f.key];
    if (f.type === "number") {
      if (v === undefined || v === null || v === "" || !Number.isFinite(Number(v))) missing.push(f.label);
    } else if (typeof v !== "string" || v.trim() === "") {
      missing.push(f.label);
    }
  }
  // L'avis d'expert doit faire partie des valeurs autorisées.
  if (code === "EXPERTISE") {
    const opinion = (d.expert_opinion as string) ?? "";
    if (opinion && !["favorable", "reserves", "defavorable"].includes(opinion)) missing.push("un avis d'expert valide (favorable / réserves / défavorable)");
  }
  return missing;
}

// Normalise les données de réalisation à stocker (ne garde que les champs connus).
export function sanitizeRealizationData(code: OptionalStepCode, data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const fields = REALIZATION_FIELDS[code] ?? [];
  const d = data ?? {};
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = d[f.key];
    if (v === undefined || v === null || v === "") continue;
    out[f.key] = f.type === "number" ? Number(v) : String(v);
  }
  return out;
}

// Métadonnée présentée à l'écran pour piloter le panneau « décision d'étape ».
export async function optionalStepMeta(manuscriptId: string, code: string) {
  if (!isOptionalDecisionStep(code)) return { step_code: code, is_optional: false as const };
  const status = await prisma.workflowStatus.findFirst({ where: { code } });
  const step = status
    ? await prisma.manuscriptStep.findUnique({ where: { manuscriptId_statusId: { manuscriptId, statusId: status.id } } })
    : null;
  return {
    step_code: code,
    is_optional: true as const,
    mode: await stepMode(code),
    label: OPTIONAL_STEP_LABELS[code],
    fields: REALIZATION_FIELDS[code],
    decided_mode: step?.realizationMode ?? null,
    skip_reason: step?.skipReason ?? null,
    data: (step?.realizationData as Record<string, unknown> | null) ?? null,
  };
}
