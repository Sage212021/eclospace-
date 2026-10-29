import { prisma } from "./prisma.js";
import { loadConfig, readApiKey, resolveModelId } from "./aiConfig.js";
import { renderReportDocx, capManuscriptText } from "./aiRunner.js";
import { readManuscriptText } from "./aiEditor.js";
import { storeFile } from "./storage.js";
import { withThinking } from "./aiThinking.js";
import { salvageObjects } from "./correctionAnomalies.js";
import type Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────
// GUIDE ÉDITORIAL D'AMÉLIORATION DU MANUSCRIT (collaboration des deux IA).
//
// L'IA d'ÉVALUATION diagnostique le manuscrit et produit un rapport pour le
// comité. SAGE, l'éditeur virtuel, EXPLOITE ce rapport ET le manuscrit INTÉGRAL
// pour transformer les observations en recommandations concrètes : un document
// distinct qui aide l'auteur à réviser (il n'est PAS un second rapport).
//
// Génération AUTOMATIQUE à la fin du rapport d'évaluation (décision opérateur) ;
// le document reste en « brouillon » : le comité l'examine et le valide avant
// toute transmission à l'auteur (les auteurs ne voient que les documents
// explicitement partagés — un brouillon ne fuite donc jamais).
// ─────────────────────────────────────────────────────────────────────────

export const GUIDE_CATEGORY = "guide_amelioration";
export const GUIDE_TITLE = "GUIDE ÉDITORIAL D'AMÉLIORATION DU MANUSCRIT";

// Budget de sortie du guide. Avec réflexion approfondie, max_tokens =
// réponse + budget de réflexion ; on garde le total ≤ 8192 (limite de sortie la
// plus basse des modèles) pour ne jamais dépasser le plafond d'un modèle donné.
const GUIDE_ANSWER_TOKENS = 5000;
const GUIDE_THINK_BUDGET = 3000;

// Consigne de SAGE pour le guide. Règle d'or : jamais de mention « IA » dans le
// livrable ; SAGE écrit au nom du Service éditorial des Éditions Éclosion.
const GUIDE_SYSTEM =
  "Tu es SAGE, l'éditeur de la maison Éclosion Édition : un éditeur professionnel expérimenté qui ACCOMPAGNE l'auteur. " +
  "On te remet le RAPPORT D'ÉVALUATION d'un manuscrit (produit par le comité de lecture) ET le MANUSCRIT INTÉGRAL. " +
  "Ta mission n'est PAS de refaire l'évaluation ni de répéter les remarques : c'est de les TRANSFORMER EN SOLUTIONS applicables, en t'appuyant sur le texte réel de l'ouvrage et sur son contexte général. " +
  "Pour chaque observation pertinente du rapport : tu retrouves le passage concerné dans le manuscrit, tu expliques clairement à l'auteur ce qui doit être amélioré et POURQUOI, tu proposes une méthode de révision, et, quand c'est utile, un exemple concret de reformulation ou de réorganisation. " +
  "Tu respectes l'INTENTION de l'auteur et la nature de l'ouvrage. Tu ne modifies rien en silence et tu n'INVENTES jamais de contenu pour combler une lacune : si une insuffisance exige des recherches, des données ou un approfondissement, tu le dis clairement plutôt que de fabriquer. " +
  "Tu n'es pas contraint de donner raison au rapport : si tu n'es pas d'accord avec une observation, ou si une recommandation demande une vérification humaine, tu le signales explicitement (« à vérifier par le comité »). " +
  "Tu n'indiques JAMAIS, ni dans le texte, ni dans un titre, ni dans une signature, que ce document est produit ou assisté par une intelligence artificielle ; tu interviens au nom du Service éditorial des Éditions Éclosion. " +
  "Tu rédiges dans une langue professionnelle mais ACCESSIBLE à l'auteur.\n\n" +
  "STRUCTURE IMPOSÉE DU GUIDE (tu produis EXACTEMENT ces rubriques, dans cet ordre, en titres Markdown « ## ») :\n" +
  "## 1. Synthèse de l'évaluation — les enjeux principaux de la révision, en quelques phrases.\n" +
  "## 2. Observations détaillées — reprends les observations pertinentes du rapport, chacune introduite par un identifiant « EVAL-001 », « EVAL-002 », … (numérotation continue).\n" +
  "## 3. Localisation des problèmes — pour chaque observation, indique le chapitre, la section et le passage concernés quand c'est possible.\n" +
  "## 4. Explication éditoriale — pourquoi chaque élément mérite d'être amélioré.\n" +
  "## 5. Recommandations — des solutions concrètes, adaptées au genre de l'ouvrage.\n" +
  "## 6. Exemples pratiques — illustre les améliorations possibles (reformulation ou restructuration).\n" +
  "## 7. Priorités de révision — distingue les modifications MAJEURES, IMPORTANTES et SECONDAIRES.\n" +
  "## 8. Feuille de route — un ordre logique de révision du manuscrit.\n\n" +
  "Référence les observations par leur identifiant EVAL-xxx dans les rubriques 3 à 7 pour qu'on puisse suivre leur traitement. N'écris NI préambule NI conclusion hors de ces rubriques.";

// Génère le guide d'amélioration pour un manuscrit à partir du rapport
// d'évaluation (texte) + du manuscrit intégral, et le range dans la GED en
// BROUILLON. Best-effort : renvoie l'id du document créé, ou null si impossible
// (IA désactivée, pas de clé, rapport vide…). Ne lève jamais — l'appelant
// (fin du rapport d'évaluation) ne doit pas échouer à cause du guide.
export async function generateImprovementGuide(opts: { manuscriptId: string; reportText: string; userId?: string | null }): Promise<string | null> {
  try {
    const report = (opts.reportText ?? "").trim();
    if (!report) return null;
    const cfg = await loadConfig();
    const apiKey = readApiKey(cfg);
    if (!cfg.enabled || !apiKey) return null;
    // SAGE = le « cerveau » éditorial (préréglage réécriture).
    const modelId = resolveModelId(cfg.models.reecriture ?? "intermediaire");

    const m = await prisma.manuscript.findUnique({
      where: { id: opts.manuscriptId },
      select: { id: true, title: true, manuscriptNumber: true, genre: { select: { label: true } }, collection: { select: { label: true } } },
    });
    if (!m) return null;

    const ms = await readManuscriptText(opts.manuscriptId);
    const manuscriptText = ms.ok ? capManuscriptText(ms.text).text : "";
    const domaine = [m.genre?.label, m.collection?.label].filter(Boolean).join(" / ") || "(non renseigné)";

    const user =
      `=== GENRE / COLLECTION DÉCLARÉS ===\n${domaine}\n\n` +
      `=== RAPPORT D'ÉVALUATION (diagnostic du comité) ===\n${report}\n\n` +
      `=== MANUSCRIT INTÉGRAL ===\n${manuscriptText || "(texte du manuscrit indisponible : appuie-toi sur le rapport et signale les points à vérifier directement sur le manuscrit)"}\n\n` +
      "=== CONSIGNE ===\nProduis le GUIDE ÉDITORIAL D'AMÉLIORATION selon la structure imposée.";

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const textOf = (blocks: { type: string }[]) => blocks.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("\n").trim();

    const first = await client.messages.create({
      model: modelId,
      ...withThinking(modelId, GUIDE_ANSWER_TOKENS, GUIDE_THINK_BUDGET),
      system: GUIDE_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    let guideText = textOf(first.content);
    // Continuation par préfixe assistant tant que la réponse est tronquée (pas
    // de réflexion sur les continuations : incompatible avec le préfixe).
    let stop = first.stop_reason;
    for (let i = 0; i < 3 && stop === "max_tokens"; i++) {
      const cont = await client.messages.create({
        model: modelId,
        max_tokens: GUIDE_ANSWER_TOKENS,
        system: GUIDE_SYSTEM,
        messages: [{ role: "user", content: user }, { role: "assistant", content: guideText }],
      });
      stop = cont.stop_reason;
      const more = textOf(cont.content);
      if (!more) break;
      guideText += more;
    }
    if (!guideText) return null;

    const docxBuffer = await renderReportDocx(GUIDE_TITLE, guideText);
    const stored = await storeFile(docxBuffer, `guide_amelioration_${m.manuscriptNumber}.docx`);
    const created = await prisma.document.create({
      data: {
        entityType: "manuscript",
        entityId: m.id,
        category: GUIDE_CATEGORY,
        title: `${GUIDE_TITLE} — ${m.title}`,
        createdBy: opts.userId ?? null,
        versions: {
          create: {
            versionNumber: 1,
            filePath: stored.filePath,
            fileSize: stored.fileSize,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sha256Hash: stored.sha256Hash,
            // BROUILLON : à examiner et valider par le comité avant transmission à l'auteur.
            status: "draft",
            changeSummary: "Guide d'amélioration établi par le Service éditorial Éclosion (à valider par le comité).",
            uploadedBy: opts.userId ?? null,
          },
        },
      },
    });

    // Version ACTIONNABLE : on extrait du guide les observations EVAL-xxx en
    // fiches SUIVABLES (recommandation + priorité + état de traitement), que le
    // comité et l'auteur pourront suivre. Best-effort : n'empêche jamais la
    // livraison du guide lui-même (qui reste le document de référence).
    try {
      const obs = await extractGuideObservations(client, modelId, guideText);
      if (obs.length) {
        await prisma.guideObservation.createMany({
          data: obs.map((o, i) => ({
            manuscriptId: m.id,
            documentId: created.id,
            number: i + 1,
            code: o.code || `EVAL-${String(i + 1).padStart(3, "0")}`,
            title: o.title,
            priority: o.priority,
            location: o.location,
            recommendation: o.recommendation,
          })),
        });
      }
    } catch { /* les fiches sont best-effort ; le guide .docx reste le livrable */ }

    return created.id;
  } catch {
    // Best-effort : un échec du guide ne doit jamais perturber le rapport d'évaluation.
    return null;
  }
}

// Extraction STRUCTURÉE des observations du guide (EVAL-xxx) en fiches suivables.
const OBS_EXTRACTION_SYSTEM =
  "On te donne un GUIDE ÉDITORIAL D'AMÉLIORATION. Renvoie UNIQUEMENT un tableau JSON des observations qu'il contient, sans aucun texte autour. " +
  "Chaque élément : {\"code\":\"EVAL-001\",\"title\":\"intitulé court de l'observation\",\"priority\":\"majeure|importante|secondaire\",\"location\":\"chapitre/section/passage si connu, sinon null\",\"recommendation\":\"la recommandation et la méthode, en une à deux phrases\"}. " +
  "Reprends EXACTEMENT les identifiants EVAL-xxx du guide et la priorité indiquée dans la rubrique « Priorités de révision ». N'invente aucune observation ; ne renvoie que ce qui figure dans le guide.";

interface ParsedObservation { code: string; title: string | null; priority: string; location: string | null; recommendation: string | null; }

function normPriority(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("majeur")) return "majeure";
  if (s.includes("secondaire") || s.includes("mineur")) return "secondaire";
  return "importante";
}
function obsStr(v: unknown, max = 2000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

async function extractGuideObservations(client: Anthropic, model: string, guideText: string): Promise<ParsedObservation[]> {
  const resp = await client.messages.create({ model, max_tokens: 4000, system: OBS_EXTRACTION_SYSTEM, messages: [{ role: "user", content: `=== GUIDE ===\n${guideText}` }] });
  const text = resp.content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("");
  let arr: unknown[] = [];
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) arr = parsed;
  } catch { /* tableau tronqué/entouré de texte : on récupère objet par objet */ }
  if (arr.length === 0) arr = salvageObjects(text);
  return arr
    .map((o) => {
      const r = (o ?? {}) as Record<string, unknown>;
      return { code: obsStr(r.code, 32) ?? "", title: obsStr(r.title, 300), priority: normPriority(r.priority), location: obsStr(r.location, 300), recommendation: obsStr(r.recommendation) };
    })
    .filter((o) => o.code || o.title || o.recommendation);
}

// ── Mode « assistance à la réécriture » (Phase 2b) ──────────────────────────
// SAGE PROPOSE une correction pour UNE observation, sans jamais modifier le
// manuscrit en silence. L'humain compare puis accepte/modifie/refuse. SAGE peut
// conclure qu'une réécriture ne suffit pas (recherche/approfondissement requis).
const REWRITE_SYSTEM =
  "Tu es SAGE, l'éditeur de la maison Éclosion Édition. On te donne UNE observation d'amélioration (identifiant, intitulé, localisation, recommandation) et le MANUSCRIT INTÉGRAL. " +
  "Pour CETTE observation uniquement, tu proposes une correction CONCRÈTE, en respectant l'intention de l'auteur et le genre de l'ouvrage. Tu ne modifies JAMAIS le manuscrit en silence et tu n'inventes aucun contenu. " +
  "Renvoie UNIQUEMENT un objet JSON, sans texte autour : " +
  "{\"applicable\": true, \"original\": \"le passage original concerné, cité tel quel (vide si non localisable)\", \"problem\": \"le problème, une à deux phrases\", \"proposal\": \"ta proposition de reformulation ou de réorganisation\", \"justification\": \"pourquoi cette proposition respecte l'intention de l'auteur et le genre\"}. " +
  "Si une simple réécriture NE SUFFIT PAS (l'observation exige des recherches, des données ou un approfondissement de la réflexion de l'auteur), mets \"applicable\": false, laisse \"proposal\" vide, et explique dans \"problem\" et \"justification\" ce que l'auteur doit faire — SANS inventer de contenu. " +
  "Tu n'indiques jamais qu'une intelligence artificielle est intervenue.";

export async function proposeRewriteForObservation(obsId: string): Promise<{ ok: boolean; status: string } | null> {
  const obs = await prisma.guideObservation.findUnique({ where: { id: obsId } });
  if (!obs) return null;
  const cfg = await loadConfig();
  const apiKey = readApiKey(cfg);
  if (!cfg.enabled || !apiKey) return null;
  const modelId = resolveModelId(cfg.models.reecriture ?? "intermediaire");
  const ms = await readManuscriptText(obs.manuscriptId);
  const manuscriptText = ms.ok ? capManuscriptText(ms.text).text : "";
  const user =
    `=== OBSERVATION ===\nIdentifiant : ${obs.code}\nIntitulé : ${obs.title ?? ""}\nLocalisation : ${obs.location ?? "(non précisée)"}\nRecommandation : ${obs.recommendation ?? ""}\n\n` +
    `=== MANUSCRIT INTÉGRAL ===\n${manuscriptText || "(texte du manuscrit indisponible : signale-le et propose la démarche)"}\n\n` +
    "=== CONSIGNE ===\nProduis l'objet JSON demandé pour CETTE observation.";
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({ model: modelId, ...withThinking(modelId, 3000, 2500), system: REWRITE_SYSTEM, messages: [{ role: "user", content: user }] });
  const text = resp.content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("");
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim()) as Record<string, unknown>;
  } catch {
    const s = salvageObjects(text);
    if (s.length) obj = s[0] as Record<string, unknown>;
  }
  const str = (v: unknown, max = 6000): string | null => {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t ? t.slice(0, max) : null;
  };
  const applicable = obj.applicable !== false;
  const status = applicable ? "proposee" : "non_applicable";
  await prisma.guideObservation.update({
    where: { id: obsId },
    data: {
      rewriteStatus: status,
      rewriteOriginal: str(obj.original),
      rewriteProblem: str(obj.problem),
      rewriteProposal: applicable ? str(obj.proposal) : null,
      rewriteJustification: str(obj.justification),
    },
  });
  return { ok: true, status };
}
