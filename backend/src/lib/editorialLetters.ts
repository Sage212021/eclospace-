import { prisma } from "./prisma.js";

// Lettre officielle de la Direction éditoriale à l'auteur (refonte 09/09/2026).
// PRINCIPE : la lettre n'est PAS la reproduction du rapport du comité. C'est
// l'acte par lequel la Direction transforme l'avis du comité en décision, dans
// un registre sobre, professionnel et institutionnel. Elle n'extrait que les
// éléments explicitement rendus « communicables » par la Direction :
//   {{points}}  = points essentiels retenus (conditions / axes de révision /
//                 motifs), déjà mis en forme (intro + puces) par l'appelant ;
//   {{message}} = message complémentaire de la Direction.
// Jamais le rapport du comité, ni les commentaires internes, ni la motivation.
// Chaque lettre se termine par le bloc « Pour Éclosion Édition » avec une zone
// de signature et de cachet : le responsable signe à la main après impression.

export type EditorialLetterKey =
  | "acceptation"
  | "acceptation_conditions"
  | "revision"
  | "refus"
  | "refus_resoumission";

export interface LetterTemplate {
  subject: string;
  body: string;
}

export const LETTER_KEYS: EditorialLetterKey[] = [
  "acceptation",
  "acceptation_conditions",
  "revision",
  "refus",
  "refus_resoumission",
];

export const LETTER_LABELS: Record<EditorialLetterKey, string> = {
  acceptation: "Décision favorable — acceptation",
  acceptation_conditions: "Acceptation sous conditions",
  revision: "Révision demandée — nouvelle soumission possible",
  refus: "Refus éditorial",
  refus_resoumission: "Refus avec possibilité de nouvelle soumission",
};

// La lettre imprimée porte le LOGO officiel (en-tête de la maison), la date et le
// destinataire alignés à droite, et se termine par un bloc de signature aligné à
// droite : « Pour Éclosion Édition », la Direction éditoriale, une zone de
// signature et de cachet et le nom du responsable — renseignés à la main après
// impression (demande opérateur du 09/09/2026). La mise en page (en-tête, date,
// destinataire, objet, signature) est FIXE et harmonieuse ; seul le corps (prose)
// est éditable dans les Réglages. Placeholders du corps : {{auteur}} {{titre}}
// {{numero}} {{genre}} {{points}} {{message}} {{maison}}.
export const DEFAULT_LETTERS: Record<EditorialLetterKey, LetterTemplate> = {
  acceptation: {
    subject: "Décision éditoriale relative à votre manuscrit « {{titre}} »",
    body: `Monsieur/Madame,

Nous vous remercions d'avoir confié votre manuscrit « {{titre}} » aux Éditions Éclosion.

À l'issue de son examen par notre comité de lecture et au regard des éléments de l'évaluation qui nous ont été transmis, nous avons le plaisir de vous informer que la Direction éditoriale a rendu une décision favorable à la publication de votre manuscrit.

{{message}}

Nous vous invitons à prendre contact avec notre administration afin d'échanger sur les prochaines étapes du processus éditorial et les modalités d'une éventuelle collaboration.

La présente correspondance constitue une notification de notre décision éditoriale et ne saurait, à elle seule, constituer un engagement contractuel de publication. Celui-ci fera l'objet, le cas échéant, d'un accord formalisé entre les parties.

Nous vous remercions pour la confiance accordée aux Éditions Éclosion et vous adressons nos sincères encouragements pour la poursuite de votre démarche d'écriture.

Veuillez recevoir, Monsieur/Madame, nos salutations distinguées.`,
  },

  acceptation_conditions: {
    subject: "Décision éditoriale relative à votre manuscrit « {{titre}} »",
    body: `Monsieur/Madame,

Nous vous remercions pour la soumission de votre manuscrit « {{titre}} » aux Éditions Éclosion.

Après examen de votre dossier et prise en considération de l'évaluation réalisée par notre comité de lecture, la Direction éditoriale a rendu une décision favorable à la poursuite du processus éditorial, sous réserve de la prise en compte de certaines recommandations.

{{points}}

Ces éléments devront être intégrés dans la version révisée du manuscrit avant la poursuite du processus éditorial.

{{message}}

Nous vous invitons à vous rapprocher de notre administration afin de prendre connaissance des modalités pratiques et des prochaines étapes.

La présente décision ne constitue pas, à elle seule, un engagement contractuel de publication. Toute collaboration éditoriale fera l'objet d'une formalisation distincte.

Nous vous remercions pour votre confiance et vous encourageons à poursuivre ce travail dans la perspective d'une éventuelle publication au sein de notre maison.

Veuillez recevoir, Monsieur/Madame, nos salutations distinguées.`,
  },

  revision: {
    subject: "Retour éditorial concernant votre manuscrit « {{titre}} »",
    body: `Monsieur/Madame,

Nous vous remercions d'avoir soumis votre manuscrit « {{titre}} » aux Éditions Éclosion et pour la confiance ainsi accordée à notre maison.

À l'issue de son examen éditorial, la Direction éditoriale estime que le manuscrit présente des éléments susceptibles de justifier une nouvelle appréciation, mais que des révisions substantielles sont nécessaires avant qu'une décision éditoriale définitive puisse être envisagée.

{{points}}

{{message}}

Nous vous invitons, si vous le souhaitez, à intégrer ces éléments dans une nouvelle version du manuscrit et à nous la soumettre pour réexamen.

Cette demande de révision ne constitue ni une acceptation ni un engagement de publication. Toute nouvelle soumission fera l'objet d'un examen éditorial indépendant.

Nous vous remercions pour l'intérêt porté aux Éditions Éclosion et restons disponibles pour toute information relative aux modalités de nouvelle soumission.

Veuillez recevoir, Monsieur/Madame, nos salutations distinguées.`,
  },

  refus: {
    subject: "Décision éditoriale relative à votre manuscrit « {{titre}} »",
    body: `Monsieur/Madame,

Nous vous remercions d'avoir choisi de soumettre votre manuscrit « {{titre}} » aux Éditions Éclosion et pour la confiance que vous avez accordée à notre maison.

Après examen de votre manuscrit et au regard des éléments issus de son évaluation éditoriale, la Direction éditoriale a décidé de ne pas retenir ce projet pour publication au sein de notre maison.

Cette décision relève de notre ligne éditoriale et de nos critères de sélection à ce stade de notre programme de publication. Elle ne constitue pas un jugement sur votre démarche d'auteur ni sur la valeur personnelle de votre travail.

{{message}}

Nous vous remercions néanmoins pour l'intérêt porté aux Éditions Éclosion et vous encourageons à poursuivre votre travail d'écriture.

Pour toute question concernant cette décision ou les modalités de clôture de votre dossier, vous pouvez vous rapprocher de notre administration.

Nous vous souhaitons pleine réussite dans la poursuite de votre parcours d'auteur.

Veuillez recevoir, Monsieur/Madame, nos salutations distinguées.`,
  },

  refus_resoumission: {
    subject: "Retour éditorial concernant votre manuscrit « {{titre}} »",
    body: `Monsieur/Madame,

Nous vous remercions d'avoir soumis votre manuscrit « {{titre}} » aux Éditions Éclosion.

Après examen de votre dossier et prise en considération des observations formulées dans le cadre de son évaluation, la Direction éditoriale a décidé de ne pas retenir le manuscrit dans sa version actuelle.

{{points}}

Toutefois, compte tenu des perspectives identifiées dans le projet, une nouvelle soumission pourrait être envisagée après une révision approfondie du manuscrit.

{{message}}

Une nouvelle version devra être soumise comme un nouveau dossier et fera l'objet d'une nouvelle évaluation éditoriale. Cette possibilité ne constitue pas une garantie de publication.

Nous vous remercions pour votre confiance et vous encourageons à poursuivre le travail engagé.

Veuillez recevoir, Monsieur/Madame, nos salutations distinguées.`,
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
  genre?: string;
  date?: string;
  place?: string;
  recipient?: string;
  points?: string;
  message?: string;
  maison: string;
  // Rétrocompatibilité : anciens modèles personnalisés pouvaient utiliser {{motivation}}.
  motivation?: string;
}

// Construit le bloc « points » (intro + puces) à insérer dans la lettre, selon la
// décision. Renvoie "" si aucun point communicable — la lettre n'affiche alors
// aucune rubrique orpheline.
export function buildPointsBlock(decision: EditorialLetterKey, points: string[]): string {
  const clean = points.map((p) => p.trim()).filter((p) => p.length > 0);
  if (clean.length === 0) return "";
  const intro =
    decision === "revision"
      ? "Les principaux axes de révision retenus sont les suivants :"
      : decision === "refus_resoumission"
        ? "Cette décision est notamment liée aux éléments suivants :"
        : "Les principaux points retenus concernent notamment :";
  return `${intro}\n${clean.map((p) => `• ${p}`).join("\n")}`;
}

export function renderLetter(tpl: LetterTemplate, ctx: LetterContext): LetterTemplate {
  const fill = (s: string) =>
    s
      .replace(/\{\{auteur\}\}/g, ctx.auteur)
      .replace(/\{\{titre\}\}/g, ctx.titre)
      .replace(/\{\{numero\}\}/g, ctx.numero)
      .replace(/\{\{genre\}\}/g, ctx.genre || "")
      .replace(/\{\{date\}\}/g, ctx.date || new Date().toLocaleDateString("fr-FR"))
      .replace(/\{\{points\}\}/g, ctx.points || "")
      .replace(/\{\{message\}\}/g, ctx.message || "")
      .replace(/\{\{motivation\}\}/g, ctx.motivation || "")
      .replace(/\{\{maison\}\}/g, ctx.maison)
      // Un placeholder vide laisse des lignes blanches : on normalise (jamais plus
      // d'une ligne vide entre deux paragraphes) et on nettoie les bords.
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

// Mise en page structurée de la lettre (en-tête logo + date/destinataire à
// droite + objet + corps + signature à droite). Le corps (prose) est éditable ;
// tout le reste est fixe et harmonieux.
export interface LetterLayout {
  place: string;
  date: string;
  recipient: string;
  objet: string;
  paragraphs: string[];
  maison: string;
}

// Construit, à partir d'un modèle et du contexte, l'objet, la mise en page
// structurée (pour l'impression à l'en-tête) et le texte intégral (pour l'e-mail
// et l'aperçu). La signature « Pour {maison} » est ajoutée automatiquement.
export function composeLetter(tpl: LetterTemplate, ctx: LetterContext): { subject: string; layout: LetterLayout; textBody: string } {
  const rendered = renderLetter(tpl, ctx);
  const paragraphs = rendered.body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const place = ctx.place?.trim() || "Yaoundé";
  const date = ctx.date || new Date().toLocaleDateString("fr-FR");
  // Le matricule (réf. de l'ouvrage) figure toujours dans l'objet de la lettre.
  const objet = `${rendered.subject} (réf. ${ctx.numero})`;
  const layout: LetterLayout = { place, date, recipient: ctx.auteur, objet, paragraphs, maison: ctx.maison };
  const textBody = [
    `${ctx.maison}`,
    "Direction éditoriale",
    `${place}, le ${date}`,
    "",
    `À Monsieur/Madame ${ctx.recipient?.trim() || ctx.auteur}`,
    "",
    `Objet : ${objet}`,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    `Pour ${ctx.maison},`,
    "La Direction éditoriale",
    "",
    "Signature et cachet : ______________________________",
    "",
    "Nom du responsable : ______________________________",
  ].join("\n");
  return { subject: rendered.subject, layout, textBody };
}

// Rendu HTML sobre, à l'en-tête de la maison, pour l'e-mail à l'auteur — avec le
// bloc de signature aligné à droite.
export function letterHtml(subject: string, bodyText: string, maison: string): string {
  const marker = `Pour ${maison},`;
  const idx = bodyText.indexOf(marker);
  const corps = idx >= 0 ? bodyText.slice(0, idx).trim() : bodyText;
  const sign = idx >= 0 ? bodyText.slice(idx).trim() : "";
  const paras = corps
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;white-space:pre-wrap">${esc(p)}</p>`)
    .join("");
  const signHtml = sign
    ? `<div style="margin-top:26px;text-align:right;white-space:pre-wrap">${esc(sign)}</div>`
    : "";
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#0b0b0c;max-width:640px;margin:0 auto;padding:8px">
    <div style="border-bottom:2px solid #D9B21A;padding-bottom:8px;margin-bottom:18px;font-weight:bold;letter-spacing:.5px;color:#0b0b0c">${esc(maison)}</div>
    ${paras}
    ${signHtml}
  </div>`;
}

// Rendu HTML de la lettre pour l'E-MAIL à l'auteur (décision auto-notifiée) :
// mise en page structurée + CACHET « Direction Éditoriale » apposé sous la
// signature. Pas de lignes « signature/cachet à la main » (inutiles dans un mail).
export function letterEmailHtml(layout: LetterLayout, cachetDataUrl?: string | null, confirmUrl?: string | null): string {
  const paras = layout.paragraphs
    .map((p) => `<p style="margin:0 0 14px;white-space:pre-wrap">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const cachet = cachetDataUrl
    ? `<img src="${cachetDataUrl}" alt="Cachet Direction Éditoriale" style="height:150px;width:auto;max-width:250px;display:inline-block;margin-top:6px">`
    : "";
  // Accusé de réception : bouton vers la page sécurisée de confirmation (le lien
  // porte un jeton unique). Présent uniquement si une URL est fournie.
  const confirm = confirmUrl
    ? `<div style="margin-top:26px;padding-top:16px;border-top:1px solid #e7e2d4;text-align:center">
        <p style="font-size:13px;color:#4b5563;margin:0 0 10px">Merci de confirmer que vous avez bien reçu cette décision :</p>
        <a href="${confirmUrl}" style="display:inline-block;background:#D9B21A;color:#0B0B0C;font-weight:700;text-decoration:none;border-radius:8px;padding:11px 20px;font-size:14px">Confirmer la réception</a>
        <p style="font-size:11px;color:#9aa1ad;margin:10px 0 0">Si le bouton ne fonctionne pas, copiez ce lien : ${confirmUrl}</p>
      </div>`
    : "";
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#0b0b0c;max-width:640px;margin:0 auto;padding:8px">
    <div style="border-bottom:2px solid #D9B21A;padding-bottom:8px;margin-bottom:18px;font-weight:bold;letter-spacing:.5px;color:#0b0b0c">${esc(layout.maison)}</div>
    <div style="text-align:right;margin:0 0 16px">${esc(layout.place)}, le ${esc(layout.date)}<br><br><span style="color:#6b7280">À l'attention de</span><br><b>Monsieur/Madame ${esc(layout.recipient)}</b></div>
    <div style="font-weight:700;margin:0 0 14px">Objet : ${esc(layout.objet)}</div>
    ${paras}
    <div style="margin-top:24px;text-align:right">
      <div style="font-weight:700">Pour ${esc(layout.maison)},</div>
      <div>La Direction éditoriale</div>
      ${cachet}
    </div>
    ${confirm}
  </div>`;
}

// Résout l'identité de la maison (nom) depuis le réglage, avec repli.
export async function houseName(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: "publisher_identity" } });
  const name = (row?.value as { name?: string } | undefined)?.name;
  return name?.trim() || "Éclosion Édition";
}
