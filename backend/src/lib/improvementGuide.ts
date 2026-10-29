import { prisma } from "./prisma.js";
import { loadConfig, readApiKey, resolveModelId } from "./aiConfig.js";
import { renderReportDocx, capManuscriptText } from "./aiRunner.js";
import { readManuscriptText } from "./aiEditor.js";
import { storeFile } from "./storage.js";
import { withThinking } from "./aiThinking.js";

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

const GUIDE_MAX_TOKENS = 8000;
const GUIDE_THINK_BUDGET = 4000;

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
      ...withThinking(modelId, GUIDE_MAX_TOKENS, GUIDE_THINK_BUDGET),
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
        max_tokens: GUIDE_MAX_TOKENS,
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
    return created.id;
  } catch {
    // Best-effort : un échec du guide ne doit jamais perturber le rapport d'évaluation.
    return null;
  }
}
