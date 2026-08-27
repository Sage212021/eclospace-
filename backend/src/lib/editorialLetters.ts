import { prisma } from "./prisma.js";

// Réponse à l'auteur à la décision éditoriale (26/08/2026) : une lettre est
// adressée à l'auteur pour toute décision terminale (acceptation, acceptation
// sous conditions, refus courtois). Modèles à placeholders, éditables par
// l'administration ; défauts professionnels ci-dessous.

export type EditorialLetterKey = "acceptation" | "acceptation_conditions" | "refus";

export interface LetterTemplate {
  subject: string;
  body: string;
}

export const LETTER_KEYS: EditorialLetterKey[] = ["acceptation", "acceptation_conditions", "refus"];

export const LETTER_LABELS: Record<EditorialLetterKey, string> = {
  acceptation: "Acceptation",
  acceptation_conditions: "Acceptation sous conditions",
  refus: "Refus (courtois)",
};

// Placeholders disponibles : {{auteur}} {{titre}} {{numero}} {{motivation}} {{maison}}
export const DEFAULT_LETTERS: Record<EditorialLetterKey, LetterTemplate> = {
  acceptation: {
    subject: "Votre manuscrit « {{titre}} » — décision favorable",
    body: `Madame, Monsieur {{auteur}},

Nous avons le plaisir de vous informer que votre manuscrit « {{titre}} » (réf. {{numero}}) a retenu l'attention de notre comité de lecture et a été accepté pour publication.

{{motivation}}

Notre équipe éditoriale reviendra vers vous très prochainement pour la suite du parcours (planification du projet, contrat d'édition).

Nous vous remercions de la confiance que vous accordez à {{maison}} et vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

Le comité éditorial
{{maison}}`,
  },
  acceptation_conditions: {
    subject: "Votre manuscrit « {{titre}} » — accepté sous conditions",
    body: `Madame, Monsieur {{auteur}},

Votre manuscrit « {{titre}} » (réf. {{numero}}) a retenu l'attention de notre comité de lecture. Nous sommes disposés à l'accompagner vers la publication, sous réserve des points suivants :

{{motivation}}

Nous vous invitons à en prendre connaissance ; notre équipe éditoriale reviendra vers vous pour convenir des modalités.

Nous vous remercions de votre confiance et vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

Le comité éditorial
{{maison}}`,
  },
  refus: {
    subject: "Votre manuscrit « {{titre}} » — réponse de notre comité",
    body: `Madame, Monsieur {{auteur}},

Nous vous remercions de nous avoir confié votre manuscrit « {{titre}} » (réf. {{numero}}) et de l'intérêt que vous portez à {{maison}}.

Après un examen attentif par notre comité de lecture, nous sommes au regret de ne pouvoir donner une suite favorable à votre projet dans le cadre de notre ligne éditoriale.

{{motivation}}

Cette décision ne préjuge en rien de la valeur de votre travail. Nous vous encourageons à le proposer à d'autres maisons et vous souhaitons pleine réussite dans vos projets d'écriture.

Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

Le comité éditorial
{{maison}}`,
  },
};

// Modèles effectifs = défauts surchargés par le réglage éditable.
export async function resolveLetterTemplates(): Promise<Record<EditorialLetterKey, LetterTemplate>> {
  const row = await prisma.setting.findUnique({ where: { key: "editorial_decision_letters" } });
  const override = (row?.value ?? {}) as Partial<Record<EditorialLetterKey, Partial<LetterTemplate>>>;
  const out = {} as Record<EditorialLetterKey, LetterTemplate>;
  for (const k of LETTER_KEYS) {
    out[k] = {
      subject: override[k]?.subject?.trim() || DEFAULT_LETTERS[k].subject,
      body: override[k]?.body?.trim() || DEFAULT_LETTERS[k].body,
    };
  }
  return out;
}

export interface LetterContext {
  auteur: string;
  titre: string;
  numero: string;
  motivation: string;
  maison: string;
}

export function renderLetter(tpl: LetterTemplate, ctx: LetterContext): LetterTemplate {
  const fill = (s: string) =>
    s
      .replace(/\{\{auteur\}\}/g, ctx.auteur)
      .replace(/\{\{titre\}\}/g, ctx.titre)
      .replace(/\{\{numero\}\}/g, ctx.numero)
      .replace(/\{\{motivation\}\}/g, ctx.motivation || "")
      .replace(/\{\{maison\}\}/g, ctx.maison);
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

// Rendu HTML sobre, à l'en-tête de la maison, pour l'e-mail à l'auteur.
export function letterHtml(subject: string, bodyText: string, maison: string): string {
  const paras = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;white-space:pre-wrap">${esc(p)}</p>`)
    .join("");
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#16233d;max-width:640px;margin:0 auto;padding:8px">
    <div style="border-bottom:2px solid #C89A1B;padding-bottom:8px;margin-bottom:18px;font-weight:bold;letter-spacing:.5px;color:#16233d">${esc(maison)}</div>
    ${paras}
  </div>`;
}

// Résout l'identité de la maison (nom) depuis le réglage, avec repli.
export async function houseName(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: "publisher_identity" } });
  const name = (row?.value as { name?: string } | undefined)?.name;
  return name?.trim() || "Éclosion Édition";
}
