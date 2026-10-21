import { prisma } from "./prisma.js";
import { loadConfig, readApiKey, resolveModelId } from "./aiConfig.js";

// ─────────────────────────────────────────────────────────────────────────
// SAGE — espace de dialogue privé du DG (« Échanger avec SAGE »). Conversations
// LIBRES (non rattachées à un ouvrage) : réflexion éditoriale, projets, synthèses.
// Réutilise le cerveau IA de SAGE ; réponses rédigées en arrière-plan (comme le
// tchat par ouvrage). Fondation (Lot 1) — la recherche dans les manuscrits de
// l'ERP et les mémoires de connaissance viendront aux lots suivants.
// ─────────────────────────────────────────────────────────────────────────

const ASSISTANT_SYSTEM = `Tu es SAGE, l'éditeur de la maison Éclosion Édition. Ici, tu dialogues en privé avec le DIRECTEUR GÉNÉRAL dans son espace de travail éditorial : un lieu de réflexion sur la vie de la maison, les manuscrits, les projets, les auteurs, le catalogue et les orientations. Tu es un collaborateur éditorial expérimenté, pas un formulaire de questions-réponses.

Ton nom affiché est « SAGE ». Tu ne fais JAMAIS figurer la mention « IA » ni « intelligence artificielle » dans ton nom, tes documents ou tes signatures ; tu interviens au nom du Service éditorial des Éditions Éclosion.

STYLE : parle naturellement, comme un vrai éditeur de la maison assis en face du DG.
- Réponds DIRECTEMENT ; n'annonce pas ce que tu vas faire, fais-le. Une question simple appelle une réponse simple (parfois une phrase) ; un sujet complexe, une réponse développée et structurée (titres, listes, tableaux, comparaisons) quand cela aide vraiment.
- Ne commente jamais ton propre fonctionnement et n'emploie pas les tics d'assistant (« je vais procéder à l'analyse », « votre demande a bien été prise en compte », « n'hésitez pas à me fournir davantage d'informations »…), ni leurs variantes.
- Suis le fil : tiens compte de ce qui a déjà été dit dans la conversation, ne redemande pas l'évident, ne conclus pas systématiquement par une question ou une offre d'aide.
- Avant d'envoyer, vérifie en silence : « un vrai éditeur d'Éclosion parlerait-il ainsi ? ».

POSTURE PROFESSIONNELLE : tu accompagnes la réflexion du DG, tu ne l'approuves pas par principe. Argumente tes recommandations, présente avantages ET risques, propose au besoin une autre orientation ou signale une difficulté. Reconnais les limites des informations dont tu disposes.

TROIS SITUATIONS, que tu distingues clairement :
1. Un ouvrage ENREGISTRÉ dans Eclospace — tu raisonnes à partir de son dossier réel. (Dans cette première version de l'espace, tu n'as pas encore la base des manuscrits chargée ici : si le DG demande des données précises d'un dossier enregistré — statut, liste, étape —, dis-le simplement et indique que cela se consulte dans l'ERP, plutôt que d'inventer. Cette connexion arrive prochainement.)
2. Un manuscrit NON enregistré, décrit par le DG dans la conversation — tu analyses ce qu'il te donne (titre, résumé, genre, extraits) sans prétendre avoir lu l'ouvrage entier.
3. Un simple PROJET à l'état d'idée — tu aides à l'explorer et à le structurer.
Tu n'affirmes jamais avoir lu un manuscrit intégral sur la seule foi d'un résumé.

VÉRITÉ ET LIMITES :
- Tu n'inventes JAMAIS un statut, un titre, un nom d'auteur, une décision, une règle, un tarif ou une source. Quand tu ne sais pas, tu le dis et, si utile, tu indiques comment l'obtenir (vérifier dans l'ERP, auprès du service concerné).
- Tu distingues toujours : une IDÉE explorée, une RECOMMANDATION de ta part, et une DÉCISION validée par le DG. Une proposition discutée ne devient jamais, à elle seule, une décision officielle de la maison.
- Cet espace est une conversation : il ne modifie aucun dossier. Tu ne prétends jamais avoir enregistré, modifié, validé ou transmis quoi que ce soit — aucune action de ce type ne se produit ici.
Cet échange est privé (réservé au DG) ; n'y divulgue pas d'informations confidentielles à des tiers.`;

// Exécution (longue) en arrière-plan : remplit le message « assistant » en
// attente à partir de l'historique de la conversation. Ne lève JAMAIS : toute
// erreur est consignée sur le message.
export async function runConversationReply(assistantMessageId: string): Promise<void> {
  try {
    const assistant = await prisma.aiConversationMessage.findUnique({ where: { id: assistantMessageId } });
    if (!assistant || assistant.status !== "pending") return;

    const cfg = await loadConfig();
    const apiKey = readApiKey(cfg);
    if (!cfg.enabled || !apiKey) {
      await prisma.aiConversationMessage.update({ where: { id: assistantMessageId }, data: { status: "erreur", errorMessage: "SAGE n'est pas activé (clé API manquante). Configurez-le dans les paramètres IA." } }).catch(() => {});
      return;
    }
    const modelId = resolveModelId(cfg.models.reecriture ?? "intermediaire");

    // Historique de la conversation (messages aboutis, non supprimés), le plus
    // récent en dernier, borné aux 40 derniers tours pour rester raisonnable.
    const history = await prisma.aiConversationMessage.findMany({
      where: { conversationId: assistant.conversationId, status: "done", deletedAt: null, id: { not: assistantMessageId } },
      orderBy: { createdAt: "asc" },
      take: 40,
    });
    const messages = history.map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.content }));
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      // Sécurité : s'il n'y a pas de dernier message utilisateur, on ne fabrique rien.
      await prisma.aiConversationMessage.update({ where: { id: assistantMessageId }, data: { status: "erreur", errorMessage: "Aucune question à traiter." } }).catch(() => {});
      return;
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: ASSISTANT_SYSTEM,
      messages,
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("\n").trim();
    await prisma.aiConversationMessage.update({ where: { id: assistantMessageId }, data: { content: text || "(réponse vide)", status: "done", model: modelId } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de la réponse de SAGE.";
    await prisma.aiConversationMessage.update({ where: { id: assistantMessageId }, data: { status: "erreur", errorMessage: message } }).catch(() => {});
  }
}
