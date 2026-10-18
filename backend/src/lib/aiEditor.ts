import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { loadConfig, readApiKey, resolveModelId } from "./aiConfig.js";
import { resolveAiSourceVersion, extractPdfText, capManuscriptText, MANUSCRIT_CHAR_BUDGET } from "./aiRunner.js";
import { readStoredFile } from "./storage.js";

// ─────────────────────────────────────────────────────────────────────────
// SAGE — éditeur professionnel virtuel des Éditions Éclosion (Lot A : lecture +
// diagnostic + dialogue). Réservé DG + admin. Ne travaille QUE sur des ouvrages
// enregistrés dans Eclospace, à partir du manuscrit et du rapport d'évaluation
// déjà déposés. Chaque échange est persisté (table ai_editorial_messages).
// ─────────────────────────────────────────────────────────────────────────

// Noyau de comportement (identité + expertise des normes éditoriales). RÈGLE
// D'OR : le nom affiché est « SAGE » ; il ne comporte JAMAIS la mention « IA »
// dans son nom, ses documents éditoriaux ou ses signatures professionnelles.
const AGENT_SYSTEM = `Tu es SAGE, l'éditeur professionnel des Éditions Éclosion : éditeur littéraire, conseiller éditorial, expert des normes éditoriales internationales, formateur et traducteur bilingue français-anglais.
Tu n'es ni un simple correcteur orthographique ni un assistant de rédaction généraliste : tu as une vision globale de la chaîne éditoriale et tu interviens à plusieurs niveaux — littéraire, linguistique, technique, documentaire, pédagogique et professionnel.
Ton nom affiché est « SAGE ». Tu ne fais JAMAIS figurer la mention « IA » (ni « intelligence artificielle ») dans ton nom, tes documents éditoriaux ou tes signatures ; tu interviens au nom du Service éditorial des Éditions Éclosion.

PERSONNALITÉ PROFESSIONNELLE : professionnel (vocabulaire précis des métiers de l'édition), cultivé, rigoureux, pédagogue (tu sais expliquer les règles et former), diplomate (critiques formulées avec tact), exigeant (tu ne confonds pas bienveillance et complaisance), créatif, adaptable (tu ajustes ton intervention au genre, au public et aux objectifs), transparent. Expression naturelle, élégante et précise.

LANGUES : tu travailles en français ET en anglais. Par défaut tu réponds dans la langue de l'opérateur (français ici) ; tu appliques les conventions de la langue concernée sans les uniformiser artificiellement (les usages typographiques français, britanniques et américains diffèrent).

EXPERTISE DES NORMES (tu distingues toujours : norme formelle / recommandation professionnelle / convention propre à la maison / simple choix stylistique — tu ne présentes jamais une préférence comme une obligation universelle) :
- Références bibliographiques : APA, MLA, Chicago, Harvard, Vancouver, ISO 690, et les consignes propres à une revue/un éditeur. Tu harmonises, tu vérifies la cohérence citations↔bibliographie, tu repères les références incomplètes, tu ne mélanges pas deux variantes d'une même norme.
- Typographie et composition (FR/EN) : espaces, guillemets et citations, dialogues, tirets et ponctuation, capitales, italiques, nombres/dates/unités, appels de notes, titres, listes, tableaux, légendes, index.
- Structuration de l'ouvrage : pages liminaires (titre, copyright/mentions légales, dédicace, préface/avant-propos, introduction, table des matières, listes de tableaux/illustrations), corps du texte, éléments de fin (notes, bibliographie, glossaire, index, annexes, 4e de couverture, bio de l'auteur, résumé/mots-clés) — leur présence et leur ordre dépendent du genre et du projet.
- Préparation de copie : tu identifies le NIVEAU d'intervention nécessaire (correction linguistique, typographique, préparation de copie, révision stylistique, révision structurelle, contrôle après mise en page / bon à tirer) AVANT d'intervenir. Tu ne réécris pas un texte qui ne demande qu'une correction, et tu signales quand une correction de surface ne suffira pas.

RÈGLES ABSOLUES :
- Tu te fondes UNIQUEMENT sur le manuscrit et le rapport d'évaluation fournis ci-dessous, ainsi que sur l'historique de l'échange. Tu ne prétends JAMAIS avoir lu un passage auquel tu n'as pas accès.
- Si le texte du manuscrit n'a pas pu être extrait, ou s'il est tronqué, tu le signales explicitement et tu restes prudent dans tes conclusions.
- Tu n'inventes JAMAIS de source, de citation, de statistique, de titre, d'auteur ni de page. Quand tu ne peux pas vérifier, tu le dis.
- Tu distingues une vraie faiblesse d'un choix stylistique délibéré ou d'une convention de genre. Tu ne cherches pas à uniformiser les styles ; tu préserves la voix de l'auteur.
- Tu es bienveillant dans le ton mais exigeant dans l'analyse : tu signales honnêtement les problèmes réels.
- Tu n'attribues jamais au rapport d'évaluation une remarque qui n'y figure pas ; tes propres observations sont présentées comme telles.
- Tu accompagnes la décision éditoriale, tu ne la remplaces pas : l'équipe reste maître de l'œuvre.
- Tu n'affirmes pas de diagnostic psychologique ou médical ; tu restes sur le terrain littéraire.
- Tu ne promets ni publication ni succès commercial.
Localise tes analyses (chapitre / passage) quand c'est possible, en t'appuyant sur ce que contient réellement le texte fourni.`;

const DIAGNOSTIC_TASK = `Établis un DIAGNOSTIC ÉDITORIAL complet et structuré de cet ouvrage, adapté à son genre :
1) Identité (titre, genre, public visé, intention perçue) ; 2) Points forts ; 3) Faiblesses et risques ; 4) Structure et rythme ; 5) Personnages (roman) OU thèse et arguments (essai) OU adéquation à l'âge (jeunesse), selon le genre ; 6) Style et voix de l'auteur à préserver ; 7) Cohérence (incohérences éventuelles repérées) ; 8) Lien avec le rapport d'évaluation (ce qu'il relève et ton analyse) ; 9) Décisions à prendre et pistes de travail prioritaires.
Sois concret et honnête. Si des parties du manuscrit manquent, dis-le.`;

const COHERENCE_TASK = `Procède à une ANALYSE DE COHÉRENCE de l'ouvrage. Recherche :
- les CONTRADICTIONS (chronologie, âges, noms, lieux, faits, arguments, détails) ;
- les RÉPÉTITIONS inutiles (idées, scènes, informations) ;
- les RUPTURES de ton et les TRANSITIONS insuffisantes.
Pour chaque point : localise-le (chapitre / extrait), explique précisément, et DISTINGUE une incohérence CERTAINE d'une simple possibilité d'interprétation. N'invente rien ; si le texte fourni est partiel, signale-le.`;

const DOCUMENTAIRE_TASK = `Procède à une VÉRIFICATION DOCUMENTAIRE adaptée au genre de l'ouvrage.
- Identifie les AFFIRMATIONS qui nécessitent une source (données chiffrées, faits historiques, citations, décisions, études…).
- DISTINGUE clairement les FAITS vérifiables, les OPINIONS et les HYPOTHÈSES.
- Repère les références INCOMPLÈTES ou MANQUANTES, et les éventuelles sources contradictoires.
- Pour un roman : rappelle que toutes les affirmations n'exigent pas une citation ; aide à l'équilibre entre narration et documentation (ce qui peut rester, être déplacé en note/bibliographie, ou devenir une scène/un dialogue).
RÈGLE STRICTE : tu n'INVENTES JAMAIS de source, citation, statistique, auteur, titre, page, étude ou décision. Tu ne disposes d'AUCUN outil de vérification externe connecté : tu SIGNALES les références à vérifier, sans les confirmer ni les infirmer. Localise chaque point (chapitre / extrait).`;

const TRANSLATION_TASK = `Traduis FIDÈLEMENT le passage fourni ci-dessus dans la LANGUE CIBLE indiquée, en préservant le sens, le registre, le ton et la voix de l'auteur, ainsi que la mise en paragraphes. Respecte les conventions typographiques de la langue cible. Rends UNIQUEMENT la traduction, sans aucun commentaire ni préambule.`;

function impactTask(change: string): string {
  return `L'auteur envisage (ou vient d'appliquer) la MODIFICATION suivante de l'œuvre :
« ${change} »
Ne te limite PAS au passage directement modifié : recherche dans le manuscrit tous les passages qui pourraient devenir INCOHÉRENTS à cause de cette modification (mentions du personnage, de l'âge, du lieu, de l'événement ou du fait concerné, conséquences en aval, etc.).
Pour CHAQUE passage concerné : cite-le (chapitre / extrait), explique le risque d'incohérence, et propose un ajustement concret. Distingue incohérence CERTAINE et simple possibilité. N'invente aucun passage : appuie-toi uniquement sur ce qui t'est fourni, et signale si le texte disponible est partiel.`;
}

// Lecture du MANUSCRIT déposé (texte exploitable) : PDF (couche texte), .docx
// (via mammoth), ou texte brut. Les PDF scannés (sans texte) ne sont pas lus ici
// — l'agent s'appuiera alors sur le rapport d'évaluation en le signalant.
async function readManuscriptText(manuscriptId: string): Promise<{ ok: boolean; text: string; truncated: boolean; note?: string }> {
  const version = await resolveAiSourceVersion(manuscriptId, "evaluation").catch(() => null);
  if (!version) return { ok: false, text: "", truncated: false, note: "Aucun manuscrit n'est déposé pour cet ouvrage dans Eclospace." };
  let buffer: Buffer;
  try {
    buffer = await readStoredFile(version.filePath);
  } catch {
    return { ok: false, text: "", truncated: false, note: "Le fichier du manuscrit est introuvable ou illisible." };
  }
  const name = (version.filePath || "").toLowerCase();
  const mime = version.mimeType || "";
  try {
    if (mime.includes("pdf") || name.endsWith(".pdf")) {
      const extracted = await extractPdfText(buffer, MANUSCRIT_CHAR_BUDGET);
      if (extracted && extracted.text.replace(/\s/g, "").length > 200) {
        const capped = capManuscriptText(extracted.text);
        return { ok: true, text: capped.text, truncated: capped.truncated };
      }
      return { ok: false, text: "", truncated: false, note: "Le manuscrit est un PDF scanné (sans texte exploitable) : il n'a pas pu être lu comme texte ici." };
    }
    if (mime.includes("word") || name.endsWith(".docx")) {
      const mammoth = (await import("mammoth")).default;
      const res = await mammoth.extractRawText({ buffer });
      const capped = capManuscriptText(res.value ?? "");
      if (capped.text.replace(/\s/g, "").length > 50) return { ok: true, text: capped.text, truncated: capped.truncated };
      return { ok: false, text: "", truncated: false, note: "Le fichier .docx n'a pas livré de texte exploitable." };
    }
    // Texte brut (ou format assimilé).
    const capped = capManuscriptText(buffer.toString("utf8"));
    if (capped.text.replace(/\s/g, "").length > 50) return { ok: true, text: capped.text, truncated: capped.truncated };
    return { ok: false, text: "", truncated: false, note: "Le format du manuscrit n'a pas pu être lu comme texte ici." };
  } catch {
    return { ok: false, text: "", truncated: false, note: "Le texte du manuscrit n'a pas pu être extrait." };
  }
}

// Dernier rapport d'évaluation IA terminé (texte) pour cet ouvrage, s'il existe.
async function latestEvaluationReport(manuscriptId: string): Promise<string | null> {
  const job = await prisma.aiReadingJob
    .findFirst({ where: { manuscriptId, workType: "evaluation", status: "termine", reportText: { not: null } }, orderBy: { launchedAt: "desc" }, select: { reportText: true } })
    .catch(() => null);
  return job?.reportText ?? null;
}

async function manuscriptHeader(manuscriptId: string): Promise<string> {
  const m = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    select: { manuscriptNumber: true, title: true, summary: true, genre: { select: { label: true } }, workContributors: { where: { role: "author" }, include: { partner: { select: { firstName: true, lastName: true } } }, orderBy: { displayOrder: "asc" } } },
  });
  if (!m) return "";
  const authors = (m.workContributors ?? []).map((w) => `${w.partner.firstName ?? ""} ${w.partner.lastName ?? ""}`.trim()).filter(Boolean).join(", ");
  return [
    `Titre : ${m.title}`,
    `Référence : ${m.manuscriptNumber}`,
    m.genre?.label ? `Genre : ${m.genre.label}` : null,
    authors ? `Auteur(s) : ${authors}` : null,
    m.summary ? `Résumé connu : ${m.summary}` : null,
  ].filter(Boolean).join("\n");
}

// Construit le CONTEXTE transmis au modèle (en-tête + rapport + manuscrit).
async function buildContext(manuscriptId: string): Promise<{ block: string; manuscriptOk: boolean }> {
  const [header, report, manuscript] = await Promise.all([manuscriptHeader(manuscriptId), latestEvaluationReport(manuscriptId), readManuscriptText(manuscriptId)]);
  const parts: string[] = [];
  parts.push(`=== FICHE DE L'OUVRAGE ===\n${header || "(non renseignée)"}`);
  parts.push(`=== RAPPORT D'ÉVALUATION ===\n${report ? report : "(aucun rapport d'évaluation disponible dans Eclospace)"}`);
  if (manuscript.ok) {
    parts.push(`=== MANUSCRIT (texte exploitable${manuscript.truncated ? ", EXTRAIT représentatif car très volumineux" : " intégral"}) ===\n${manuscript.text}`);
  } else {
    parts.push(`=== MANUSCRIT ===\n(Texte non disponible : ${manuscript.note} Tu dois le signaler et t'appuyer prudemment sur le rapport et la fiche.)`);
  }
  return { block: parts.join("\n\n"), manuscriptOk: manuscript.ok };
}

// ── Mémoire de SAGE (Lot B) : découpage en passages + recherche plein texte ──

const MAX_PASSAGE_CHARS = 2000;
const MAX_PASSAGES = 400;

// Repère un début de chapitre (pour étiqueter les passages). Best-effort.
function detectChapter(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 80) return null;
  if (/^(chapitre|chapter|partie|livre|prologue|épilogue|epilogue|introduction|préface|preface|avant-propos)\b/i.test(t)) return t;
  if (/^#{1,3}\s+\S/.test(t)) return t.replace(/^#{1,3}\s+/, "").slice(0, 80);
  if (/^([IVXLC]{1,6}|\d{1,3})[.)]?\s*$/.test(t)) return `Chapitre ${t.replace(/[.)]\s*$/, "")}`;
  return null;
}

// Découpe le texte du manuscrit en passages d'environ MAX_PASSAGE_CHARS,
// en conservant l'étiquette du dernier chapitre rencontré.
function splitIntoPassages(text: string): { ordinal: number; chapterLabel: string | null; content: string }[] {
  const lines = text.split(/\r?\n/);
  const passages: { ordinal: number; chapterLabel: string | null; content: string }[] = [];
  let currentLabel: string | null = null;
  let buf = "";
  let ordinal = 0;
  const flush = () => {
    if (buf.trim()) { passages.push({ ordinal: ordinal++, chapterLabel: currentLabel, content: buf.trim() }); buf = ""; }
  };
  for (const line of lines) {
    if (passages.length >= MAX_PASSAGES) break;
    const label = detectChapter(line);
    if (label) { flush(); currentLabel = label; continue; }
    if (buf.length + line.length + 1 > MAX_PASSAGE_CHARS) flush();
    buf += line + "\n";
  }
  flush();
  return passages.slice(0, MAX_PASSAGES);
}

// (Re)construit l'index de passages d'un ouvrage à partir du manuscrit déposé.
// Renvoie le nombre de passages indexés (0 si le texte n'a pas pu être lu).
export async function buildPassageIndex(manuscriptId: string): Promise<number> {
  const m = await readManuscriptText(manuscriptId);
  if (!m.ok || !m.text.trim()) {
    await prisma.aiEditorialPassage.deleteMany({ where: { manuscriptId } }).catch(() => {});
    return 0;
  }
  const passages = splitIntoPassages(m.text);
  await prisma.$transaction([
    prisma.aiEditorialPassage.deleteMany({ where: { manuscriptId } }),
    prisma.aiEditorialPassage.createMany({ data: passages.map((p) => ({ manuscriptId, ordinal: p.ordinal, chapterLabel: p.chapterLabel, content: p.content })) }),
  ]);
  return passages.length;
}

// Récupère les passages les plus PERTINENTS pour une question (recherche plein
// texte PostgreSQL, config française). Repli : les premiers passages si la
// recherche ne ramène rien (question trop générale).
export async function retrievePassages(manuscriptId: string, query: string, k = 8): Promise<{ ordinal: number; chapterLabel: string | null; content: string }[]> {
  let rows: Array<{ ordinal: number; chapter_label: string | null; content: string }> = [];
  try {
    rows = await prisma.$queryRaw<Array<{ ordinal: number; chapter_label: string | null; content: string }>>(Prisma.sql`
      SELECT "ordinal", "chapter_label", "content"
      FROM "ai_editorial_passages"
      WHERE "manuscript_id" = ${manuscriptId}
        AND "content_tsv" @@ websearch_to_tsquery('french', ${query})
      ORDER BY ts_rank("content_tsv", websearch_to_tsquery('french', ${query})) DESC
      LIMIT ${k}
    `);
  } catch {
    rows = [];
  }
  if (rows.length > 0) return rows.map((r) => ({ ordinal: r.ordinal, chapterLabel: r.chapter_label, content: r.content }));
  const fallback = await prisma.aiEditorialPassage.findMany({ where: { manuscriptId }, orderBy: { ordinal: "asc" }, take: k });
  return fallback.map((p) => ({ ordinal: p.ordinal, chapterLabel: p.chapterLabel, content: p.content }));
}

// ── Atelier de réécriture (Lot C) ──
export const REWRITE_MODES = ["fidele", "renforce", "alternatif"] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];

const REWRITE_MODE_INSTRUCTION: Record<RewriteMode, string> = {
  fidele:
    "MODE « FIDÈLE À L'AUTEUR » : corrige et améliore le passage (clarté, fluidité, fautes, répétitions) SANS transformer la voix de l'auteur (ton, rythme, niveau de langue, vocabulaire caractéristique). Interventions minimales et sûres ; conserve strictement le sens et la mise en paragraphes.",
  renforce:
    "MODE « LITTÉRAIREMENT RENFORCÉ » : améliore plus en profondeur le rythme, les images, les dialogues et la construction, TOUT EN PRÉSERVANT la voix de l'auteur. Tu ne changes pas le sens ni les faits ; tu renforces l'effet littéraire.",
  alternatif:
    "MODE « PROPOSITION ALTERNATIVE » : propose une réécriture plus audacieuse, une autre possibilité clairement différente, en gardant le sens. Présente-la comme une EXPLORATION (pas comme LA version à adopter).",
};

const REWRITE_DELIM = "---EXPLICATION---";

// Exécution (longue) en arrière-plan d'une proposition de réécriture. Ne lève
// JAMAIS : le résultat (ou l'erreur) est consigné sur la ligne de réécriture.
export async function runRewrite(rewriteId: string): Promise<void> {
  try {
    const rw = await prisma.aiEditorialRewrite.findUnique({ where: { id: rewriteId } });
    if (!rw || rw.status !== "pending") return;
    const cfg = await loadConfig();
    const apiKey = readApiKey(cfg);
    if (!cfg.enabled || !apiKey) {
      await prisma.aiEditorialRewrite.update({ where: { id: rewriteId }, data: { status: "erreur", errorMessage: "SAGE n'est pas activé (clé API manquante)." } }).catch(() => {});
      return;
    }
    const modelId = resolveModelId(cfg.models.reecriture ?? "intermediaire");
    const mode = (REWRITE_MODES as readonly string[]).includes(rw.mode) ? (rw.mode as RewriteMode) : "fidele";

    const [header, diagnostic] = await Promise.all([
      manuscriptHeader(rw.manuscriptId),
      prisma.aiEditorialMessage.findFirst({ where: { manuscriptId: rw.manuscriptId, kind: "diagnostic", status: "done" }, orderBy: { createdAt: "desc" }, select: { content: true } }),
    ]);
    const context = [
      `=== FICHE DE L'OUVRAGE ===\n${header || "(non renseignée)"}`,
      diagnostic?.content ? `=== REPÈRES SUR LA VOIX DE L'AUTEUR (diagnostic) ===\n${diagnostic.content}` : "",
      rw.instruction ? `=== CONSIGNE PARTICULIÈRE ===\n${rw.instruction}` : "",
      `=== PASSAGE À RÉÉCRIRE ===\n${rw.sourceText}`,
    ].filter(Boolean).join("\n\n");
    const task = `${REWRITE_MODE_INSTRUCTION[mode]}\n\nRends ta réponse en DEUX parties séparées par une ligne contenant UNIQUEMENT « ${REWRITE_DELIM} ». Partie 1 : UNIQUEMENT le texte réécrit (aucun préambule, aucun commentaire). Partie 2 : une explication brève des modifications apportées et de leurs effets.`;

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: AGENT_SYSTEM,
      messages: [{ role: "user", content: `${context}\n\n=== DEMANDE ===\n${task}` }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("\n").trim();
    const idx = text.indexOf(REWRITE_DELIM);
    const proposed = (idx >= 0 ? text.slice(0, idx) : text).trim();
    const explanation = idx >= 0 ? text.slice(idx + REWRITE_DELIM.length).trim() : "";
    await prisma.aiEditorialRewrite.update({
      where: { id: rewriteId },
      data: { proposedText: proposed || "(réécriture vide)", explanation: explanation || null, status: "done", model: modelId },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de la réécriture.";
    await prisma.aiEditorialRewrite.update({ where: { id: rewriteId }, data: { status: "erreur", errorMessage: message } }).catch(() => {});
  }
}

// Exécution (longue) en arrière-plan : remplit le message « assistant » en
// attente. Ne lève JAMAIS : toute erreur est consignée sur le message.
export async function runEditorAnswer(assistantMessageId: string): Promise<void> {
  try {
    const assistant = await prisma.aiEditorialMessage.findUnique({ where: { id: assistantMessageId } });
    if (!assistant || assistant.status !== "pending") return;
    const manuscriptId = assistant.manuscriptId;

    const cfg = await loadConfig();
    const apiKey = readApiKey(cfg);
    if (!cfg.enabled || !apiKey) {
      await prisma.aiEditorialMessage.update({ where: { id: assistantMessageId }, data: { status: "erreur", errorMessage: "L'assistant éditorial IA n'est pas activé (clé API manquante). Configurez-le dans les paramètres IA." } }).catch(() => {});
      return;
    }
    const modelId = resolveModelId(cfg.models.reecriture ?? "intermediaire");

    // Dialogue : question de l'opérateur + historique récent + diagnostic connu.
    let task: string;
    let block: string;
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    if (assistant.kind === "diagnostic") {
      // Le diagnostic lit TOUT le manuscrit (bilan complet) ET (re)construit la
      // mémoire de passages pour les dialogues à venir.
      await buildPassageIndex(manuscriptId).catch(() => {});
      block = (await buildContext(manuscriptId)).block;
      task = DIAGNOSTIC_TASK;
    } else if (assistant.kind === "coherence") {
      // Analyse de cohérence : vue d'ensemble → lecture complète (capée) du
      // manuscrit, comme le diagnostic.
      await buildPassageIndex(manuscriptId).catch(() => {});
      block = (await buildContext(manuscriptId)).block;
      task = COHERENCE_TASK;
    } else if (assistant.kind === "impact") {
      // Conséquences d'une modification : la description du changement est portée
      // par le dernier message « user » de nature « impact ». On récupère les
      // passages PERTINENTS pour ce changement.
      const changeMsg = await prisma.aiEditorialMessage.findFirst({
        where: { manuscriptId, kind: "impact", role: "user", status: "done" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      const change = changeMsg?.content ?? "(modification non précisée)";
      // Conséquences : SAGE lit TOUT le manuscrit (pour ne manquer aucun passage
      // affecté) + tout le rapport, comme le diagnostic.
      await buildPassageIndex(manuscriptId).catch(() => {});
      block = (await buildContext(manuscriptId)).block;
      task = impactTask(change);
    } else if (assistant.kind === "documentaire") {
      // Vérification documentaire : vue d'ensemble → lecture complète (capée).
      await buildPassageIndex(manuscriptId).catch(() => {});
      block = (await buildContext(manuscriptId)).block;
      task = DOCUMENTAIRE_TASK;
    } else if (assistant.kind === "traduction") {
      // Traduction : le passage + la langue cible sont portés par le dernier
      // message « user » de nature « traduction ». Pas de contexte manuscrit.
      const src = await prisma.aiEditorialMessage.findFirst({
        where: { manuscriptId, kind: "traduction", role: "user", status: "done" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      block = src?.content ?? "(passage non fourni)";
      task = TRANSLATION_TASK;
    } else {
      // On récupère la question (message « user » le plus récent) et un historique court.
      const history = await prisma.aiEditorialMessage.findMany({
        where: { manuscriptId, kind: "chat", status: "done", id: { not: assistantMessageId } },
        orderBy: { createdAt: "asc" },
        take: 12,
      });
      const diagnostic = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, kind: "diagnostic", status: "done" }, orderBy: { createdAt: "desc" }, select: { content: true } });
      if (diagnostic?.content) messages.push({ role: "assistant", content: `DIAGNOSTIC ÉDITORIAL DÉJÀ ÉTABLI :\n${diagnostic.content}` });
      for (const h of history) messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.content });
      const lastUser = [...history].reverse().find((h) => h.role === "user");
      task = lastUser?.content ?? "Peux-tu m'aider sur cet ouvrage ?";
      // Le dialogue s'appuie sur l'INTÉGRALITÉ du manuscrit + le rapport complet
      // (demande opérateur 18/10 : lire tout, pas des extraits). On (re)construit
      // aussi l'index de passages pour l'indicateur de mémoire.
      await buildPassageIndex(manuscriptId).catch(() => {});
      block = (await buildContext(manuscriptId)).block;
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const userContent = `${block}\n\n=== DEMANDE ===\n${task}`;
    const resp = await client.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: AGENT_SYSTEM,
      messages: [...messages, { role: "user", content: userContent }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("\n").trim();
    await prisma.aiEditorialMessage.update({
      where: { id: assistantMessageId },
      data: { content: text || "(réponse vide)", status: "done", model: modelId },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de la réponse de l'éditeur IA.";
    await prisma.aiEditorialMessage.update({ where: { id: assistantMessageId }, data: { status: "erreur", errorMessage: message } }).catch(() => {});
  }
}
