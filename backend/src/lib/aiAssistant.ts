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
1. Un ouvrage ENREGISTRÉ dans Eclospace — tu disposes ci-dessous du CATALOGUE réel de la maison (métadonnées : référence, titre, auteur(s), genre, étape actuelle). Pour toute question sur des ouvrages enregistrés (ex. « manuscrits en attente d'évaluation », « projets bloqués et à quelle étape », « retrouve le dossier de tel auteur », « compare les ouvrages de cette collection »), tu t'appuies UNIQUEMENT sur ces données réelles. Si un ouvrage ou un auteur n'y figure pas, tu le dis clairement et tu n'inventes rien. Le catalogue donne les métadonnées et l'étape, pas le contenu intégral des manuscrits : pour une analyse du texte lui-même, renvoie à l'espace « SAGE — Éditeur » de l'ouvrage.
2. Un manuscrit NON enregistré, décrit par le DG dans la conversation — tu analyses ce qu'il te donne (titre, résumé, genre, extraits) sans prétendre avoir lu l'ouvrage entier.
3. Un simple PROJET à l'état d'idée — tu aides à l'explorer et à le structurer.
Tu n'affirmes jamais avoir lu un manuscrit intégral sur la seule foi d'un résumé ou d'une fiche de catalogue.

VÉRITÉ ET LIMITES :
- Tu n'inventes JAMAIS un statut, un titre, un nom d'auteur, une décision, une règle, un tarif ou une source. Quand tu ne sais pas, tu le dis et, si utile, tu indiques comment l'obtenir (vérifier dans l'ERP, auprès du service concerné).
- Tu distingues toujours : une IDÉE explorée, une RECOMMANDATION de ta part, et une DÉCISION validée par le DG. Une proposition discutée ne devient jamais, à elle seule, une décision officielle de la maison.
- Cet espace est une conversation : il ne modifie aucun dossier. Tu ne prétends jamais avoir enregistré, modifié, validé ou transmis quoi que ce soit — aucune action de ce type ne se produit ici.
Cet échange est privé (réservé au DG) ; n'y divulgue pas d'informations confidentielles à des tiers.`;

// Instantané RÉEL du catalogue d'Eclospace (métadonnées des manuscrits), fourni
// à SAGE comme contexte pour répondre sur les ouvrages enregistrés — SANS créer
// de seconde base : lecture directe des dossiers de l'ERP. Borné pour rester
// raisonnable ; le total exact est indiqué même quand la liste est tronquée.
const CATALOGUE_MAX = 250;
async function buildCatalogueContext(): Promise<string> {
  const [total, manuscripts] = await Promise.all([
    prisma.manuscript.count({ where: { deletedAt: null } }),
    prisma.manuscript.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: CATALOGUE_MAX,
      select: {
        manuscriptNumber: true, title: true, receivedAt: true, updatedAt: true,
        genre: { select: { label: true } },
        status: { select: { code: true, label: true } },
        workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, select: { partner: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ]);
  if (total === 0) return "=== CATALOGUE ECLOSPACE ===\n(Aucun ouvrage enregistré pour l'instant.)";
  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
  const lines = manuscripts.map((m) => {
    const authors = m.workContributors.map((w) => `${w.partner.firstName ?? ""} ${w.partner.lastName ?? ""}`.trim()).filter(Boolean).join(", ") || "auteur non renseigné";
    const genre = m.genre?.label ?? "genre non précisé";
    const step = m.status ? `${m.status.label} (${m.status.code})` : "étape inconnue";
    return `- [${m.manuscriptNumber}] ${m.title} — ${authors} · ${genre} · Étape : ${step} · reçu le ${fmtDate(m.receivedAt)} · maj ${fmtDate(m.updatedAt)}`;
  });
  const header = `=== CATALOGUE ECLOSPACE (données réelles au ${new Date().toLocaleDateString("fr-FR")}) ===\n${total} ouvrage(s) enregistré(s)${manuscripts.length < total ? ` ; ${manuscripts.length} ci-dessous (les plus récemment mis à jour)` : ""}. Format : [réf] Titre — Auteur(s) · Genre · Étape (code) · dates.`;
  return `${header}\n${lines.join("\n")}`;
}

// Mémoire institutionnelle & éditoriale VALIDÉE (Lot 3) : connaissances durables
// de la maison que SAGE doit prendre pour vraies. Seules les entrées validées et
// non supprimées sont fournies. Bornée.
const KNOWLEDGE_LABELS: Record<string, string> = {
  institution: "Institution", editorial: "Éditorial", procedure: "Procédure",
  collection: "Collection", decision: "Décision", autre: "Autre",
};
const KNOWLEDGE_MAX = 120;
async function buildKnowledgeContext(): Promise<string> {
  const entries = await prisma.aiKnowledge.findMany({
    where: { status: "validated", deletedAt: null },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    take: KNOWLEDGE_MAX,
    select: { category: true, title: true, content: true },
  });
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- [${KNOWLEDGE_LABELS[e.category] ?? e.category}] ${e.title} : ${e.content}`);
  return `=== CONNAISSANCES VALIDÉES SUR ÉCLOSION ÉDITION (mémoire officielle de la maison) ===\nCes informations ont été validées par la Direction : tu les tiens pour exactes et tu t'y appuies en priorité. Si une information manque ou n'est pas ici, tu le dis sans l'inventer.\n${lines.join("\n")}`;
}

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

    // Contexte : la consigne de comportement + la mémoire validée de la maison
    // + l'instantané RÉEL du catalogue d'Eclospace (sans rien inventer).
    const [catalogue, knowledge] = await Promise.all([
      buildCatalogueContext().catch(() => ""),
      buildKnowledgeContext().catch(() => ""),
    ]);
    const system = [ASSISTANT_SYSTEM, knowledge, catalogue].filter(Boolean).join("\n\n");

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: modelId,
      max_tokens: 4096,
      system,
      messages,
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("\n").trim();
    await prisma.aiConversationMessage.update({ where: { id: assistantMessageId }, data: { content: text || "(réponse vide)", status: "done", model: modelId } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de la réponse de SAGE.";
    await prisma.aiConversationMessage.update({ where: { id: assistantMessageId }, data: { status: "erreur", errorMessage: message } }).catch(() => {});
  }
}
