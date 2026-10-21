import { Prisma } from "@prisma/client";
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

COMPÉTENCES DE DIRECTION ÉDITORIALE : au-delà du travail sur un manuscrit, tu raisonnes comme un directeur éditorial expérimenté lorsque le DG aborde la vie de la maison. Tu maîtrises et mobilises :
- La LIGNE ÉDITORIALE : tu aides à la définir, à la formuler et à la faire respecter ; tu juges la cohérence d'un projet avec l'identité et les collections d'Éclosion, et tu signales les écarts.
- Le PROGRAMME ÉDITORIAL : tu aides à bâtir et équilibrer un programme (répartition par genre, par collection, par période ; rythme de parution ; cohérence d'ensemble), en t'appuyant sur le catalogue réel et jamais sur des parutions inventées.
- La POLITIQUE D'ACQUISITION : tu aides à détecter et sélectionner les projets (potentiel, originalité, adéquation au lectorat et à la ligne, faisabilité), en pesant l'intérêt éditorial ET le risque.
- La SUPERVISION DU PROCESSUS : tu as une vision globale de la chaîne (dépôt → lecture → contrat → correction → maquette → BAT → impression → stock → ventes → droits) ; tu sais situer un ouvrage, repérer les goulots et les étapes en attente, et proposer des priorités — à partir des données réelles de l'ERP, via les outils de recherche.
- La CONSCIENCE ÉCONOMIQUE ET COMMERCIALE : tu intègres le coût, le tirage, le prix, la marge et le positionnement commercial dans tes recommandations, sans jamais citer un chiffre que tu n'as pas ; quand une donnée financière manque, tu l'indiques et tu renvoies au pôle financier.
- Les DÉLAIS ET OBJECTIFS DE PRODUCTION : tu raisonnes en termes de calendrier, de jalons et de tenue des échéances, et tu alertes sur les retards visibles dans les données.
- Les INDICATEURS (KPIs) : tu sais proposer et lire des indicateurs éditoriaux pertinents (manuscrits en cours par étape, délais moyens, projets bloqués, respect du programme), en les calculant uniquement sur des données réelles et en précisant quand une mesure n'est pas disponible.
- La VEILLE, L'INNOVATION et le REPORTING : tu aides à structurer une analyse, à formuler des recommandations d'orientation et à préparer une synthèse claire pour la direction (une note de décision, un point de programme), en distinguant toujours ce qui relève du constat, de la recommandation et de la décision.
Tu restes un conseiller : les arbitrages de ligne, de programme, d'acquisition et de budget appartiennent au DG. Tu éclaires la décision, tu ne la prends pas à sa place.

TROIS SITUATIONS, que tu distingues clairement :
1. Un ouvrage ENREGISTRÉ dans Eclospace — tu disposes ci-dessous du CATALOGUE réel de la maison (métadonnées : référence, titre, auteur(s), genre, étape actuelle). Pour toute question sur des ouvrages enregistrés (ex. « manuscrits en attente d'évaluation », « projets bloqués et à quelle étape », « retrouve le dossier de tel auteur », « compare les ouvrages de cette collection »), tu t'appuies UNIQUEMENT sur ces données réelles. Si un ouvrage ou un auteur n'y figure pas, tu le dis clairement et tu n'inventes rien. Le catalogue donne les métadonnées et l'étape, pas le contenu intégral des manuscrits : pour une analyse du texte lui-même, renvoie à l'espace « SAGE — Éditeur » de l'ouvrage.
2. Un manuscrit NON enregistré, décrit par le DG dans la conversation — tu analyses ce qu'il te donne (titre, résumé, genre, extraits) sans prétendre avoir lu l'ouvrage entier.
3. Un simple PROJET à l'état d'idée — tu aides à l'explorer et à le structurer.
Tu n'affirmes jamais avoir lu un manuscrit intégral sur la seule foi d'un résumé ou d'une fiche de catalogue.

OUTILS DE RECHERCHE (données réelles d'Eclospace) : tu disposes d'outils pour (1) rechercher un manuscrit par titre, auteur ou référence, et (2) ouvrir son DOSSIER détaillé — étape actuelle dans le processus paramétré, collaborateur/service affecté, dernières opérations et validations enregistrées, étapes en attente ou blocages, et documents déjà déposés (type, date, déposant). Utilise ces outils dès que le DG pose une question précise sur un ouvrage enregistré ; ne te contente pas du catalogue résumé ci-dessous pour ces cas. Les documents que tu retrouves via le dossier sont automatiquement proposés au DG en ouverture/téléchargement : tu peux les nommer dans ta réponse (type, date, déposant) et indiquer lequel est le plus récent, sans jamais inventer un document, une étape ou une validation. Si le dossier ou un document n'existe pas, dis-le clairement.

RECHERCHE WEB (accès Internet réel) : tu disposes d'un outil de recherche sur le Web. Déclenche une recherche quand une tâche l'exige vraiment — vérifier une donnée, une date, une statistique, une référence ou une actualité ; suivre le marché du livre et de l'édition ; te renseigner sur un auteur, un éditeur, une publication ou une norme — et évite-la quand tes informations suffisent. Hiérarchise les sources par fiabilité : officielles et institutionnelles pour le réglementaire ; publications scientifiques et ouvrages de référence pour le spécialisé ; sources primaires quand elles existent ; médias reconnus pour l'actualité ; sources professionnelles du livre pour le marché. Confronte plusieurs sources indépendantes quand l'enjeu ou le risque d'erreur le justifie, et ne tiens pas une information pour vraie du seul fait qu'elle apparaît dans les résultats. TRAÇABILITÉ : pour toute recherche importante, indique la source (titre, organisme ou auteur si connu, date si connue) et le lien, et distingue le fait vérifié, l'analyse, l'hypothèse et ce qui reste à confirmer. Tu ne FABRIQUES JAMAIS une référence, une citation, un lien ou une statistique : si tu ne trouves pas, tu le dis. CONFIDENTIALITÉ : tu n'envoies JAMAIS à la recherche web le contenu d'un manuscrit ni une information confidentielle d'Éclosion ; tu ne formules que des requêtes générales. Si la recherche est indisponible ou échoue, signale-le et appuie-toi prudemment sur ce que tu sais, sans rien inventer.

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

// ── Outils de lecture de l'ERP (tool-calling) : position exacte d'un manuscrit
// et documents déposés. Lecture seule ; aucune donnée inventée. ───────────────

export type DocAttachment = { version_id: string; label: string; kind: string; manuscript: string; download_path: string };

const DOC_KIND_LABELS: Record<string, string> = {
  manuscrit: "Manuscrit", rapport_lecture: "Rapport de lecture/évaluation", contrat: "Contrat", bat: "BAT",
  facture: "Facture", visuel: "Visuel", rapport_comparaison: "Rapport de comparaison", couverture: "Couverture",
  livre_monte: "Livre monté", piece_archivage: "Pièce d'archivage", piece_etape: "Pièce d'étape",
  preuve_livraison: "Preuve de livraison", justificatif_stock: "Justificatif de stock", cni: "CNI", niu: "NIU", autre: "Autre",
};

const SAGE_TOOLS = [
  {
    name: "rechercher_manuscrits",
    description: "Recherche des manuscrits enregistrés dans Eclospace par titre, auteur ou référence. Renvoie les correspondances (référence, titre, auteur, genre, étape actuelle).",
    input_schema: { type: "object" as const, properties: { query: { type: "string", description: "Titre, nom d'auteur ou référence (même partiel)." } }, required: ["query"] },
  },
  {
    name: "dossier_manuscrit",
    description: "Ouvre le dossier détaillé d'UN manuscrit enregistré : identité, étape actuelle dans le processus, collaborateur/service affecté, dernières opérations et validations, étapes en attente ou blocages, et documents déposés (type, date, déposant). À utiliser pour répondre précisément sur un ouvrage.",
    input_schema: { type: "object" as const, properties: { reference: { type: "string", description: "Référence, titre ou auteur du manuscrit." } }, required: ["reference"] },
  },
];

// Recherche web côté serveur Anthropic (section 16) : Anthropic exécute la
// recherche et renvoie les résultats (avec URL) dans la même réponse. Variante
// « de base » (large compatibilité modèles). Si le modèle/clé ne la supporte
// pas, l'appel échoue → on réessaie SANS cet outil (dégradation gracieuse).
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

type WebSource = { title: string; url: string };

// Collecte les sources web (blocs `web_search_tool_result`) d'une réponse, pour
// la traçabilité. En cas d'erreur de l'outil, le `content` est un OBJET (pas une
// liste) : on l'ignore silencieusement.
function collectWebSources(blocks: Array<{ type: string; content?: unknown }>, into: Map<string, WebSource>): void {
  for (const b of blocks) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const item of b.content as Array<{ type?: string; url?: string; title?: string }>) {
      if (item?.type === "web_search_result" && item.url) into.set(item.url, { title: item.title || item.url, url: item.url });
    }
  }
}

async function usernamesByIds(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  if (clean.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: clean } }, select: { id: true, username: true } });
  return new Map(users.map((u) => [u.id, u.username]));
}

const manuscriptSelect = {
  id: true, manuscriptNumber: true, title: true, summary: true, receivedAt: true, updatedAt: true,
  genre: { select: { label: true } },
  status: { select: { id: true, code: true, label: true } },
  workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" as const }, select: { partner: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.ManuscriptSelect;

function authorsOf(m: { workContributors: { partner: { firstName: string | null; lastName: string | null } }[] }): string {
  return m.workContributors.map((w) => `${w.partner.firstName ?? ""} ${w.partner.lastName ?? ""}`.trim()).filter(Boolean).join(", ") || "auteur non renseigné";
}

async function findManuscript(ref: string) {
  const q = ref.trim();
  if (!q) return null;
  let m = await prisma.manuscript.findFirst({ where: { deletedAt: null, manuscriptNumber: { equals: q, mode: "insensitive" } }, select: manuscriptSelect });
  if (!m) m = await prisma.manuscript.findFirst({ where: { deletedAt: null, OR: [{ manuscriptNumber: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] }, orderBy: { updatedAt: "desc" }, select: manuscriptSelect });
  if (!m) m = await prisma.manuscript.findFirst({ where: { deletedAt: null, workContributors: { some: { role: "author", partner: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } } }, orderBy: { updatedAt: "desc" }, select: manuscriptSelect });
  return m;
}

// Exécute un outil ; renvoie le JSON (texte) à remettre au modèle. Les documents
// rencontrés sont collectés dans `docs` (pour être proposés au DG).
async function executeTool(name: string, input: Record<string, unknown>, docs: Map<string, DocAttachment>): Promise<string> {
  try {
    if (name === "rechercher_manuscrits") {
      const q = String(input.query ?? "").trim();
      const matches = q
        ? await prisma.manuscript.findMany({
            where: { deletedAt: null, OR: [{ manuscriptNumber: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { workContributors: { some: { role: "author", partner: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } } }] },
            orderBy: { updatedAt: "desc" }, take: 15, select: manuscriptSelect,
          })
        : [];
      return JSON.stringify({
        count: matches.length,
        resultats: matches.map((m) => ({ reference: m.manuscriptNumber, titre: m.title, auteur: authorsOf(m), genre: m.genre?.label ?? null, etape: m.status ? `${m.status.label} (${m.status.code})` : null })),
      });
    }

    if (name === "dossier_manuscrit") {
      const m = await findManuscript(String(input.reference ?? ""));
      if (!m) return JSON.stringify({ trouve: false, message: "Aucun manuscrit correspondant dans Eclospace." });

      const [steps, documents, aiJobs] = await Promise.all([
        prisma.manuscriptStep.findMany({ where: { manuscriptId: m.id }, include: { status: { select: { code: true, label: true, stepOrder: true } } }, orderBy: { status: { stepOrder: "asc" } } }),
        prisma.document.findMany({ where: { entityType: "manuscript", entityId: m.id, deletedAt: null }, select: { id: true, category: true, title: true, createdAt: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, versionNumber: true, uploadedAt: true, uploadedBy: true } } } }),
        prisma.aiReadingJob.findMany({ where: { manuscriptId: m.id, status: "termine" }, select: { workType: true, launchedAt: true } }),
      ]);
      const names = await usernamesByIds([...steps.map((s) => s.responsibleId), ...steps.map((s) => s.validationBy), ...documents.flatMap((d) => d.versions.map((v) => v.uploadedBy))]);

      const currentStep = steps.find((s) => s.status.code === m.status?.code);
      const lastValidated = steps.filter((s) => s.validatedAt).sort((a, b) => (b.validatedAt!.getTime() - a.validatedAt!.getTime()))[0];

      const docsOut = documents.map((d) => {
        const v = d.versions[0];
        const label = `${DOC_KIND_LABELS[d.category] ?? d.category} — ${d.title}`;
        if (v) docs.set(v.id, { version_id: v.id, label, kind: d.category, manuscript: m.title, download_path: `/api/v1/document-versions/${v.id}/download` });
        return {
          type: DOC_KIND_LABELS[d.category] ?? d.category, nom: d.title,
          version: v?.versionNumber ?? null,
          depose_le: v ? new Date(v.uploadedAt).toISOString().slice(0, 10) : null,
          depose_par: v?.uploadedBy ? names.get(v.uploadedBy) ?? null : null,
          telechargeable: !!v,
        };
      });

      return JSON.stringify({
        trouve: true,
        reference: m.manuscriptNumber, titre: m.title, auteur: authorsOf(m), genre: m.genre?.label ?? null, resume: m.summary ?? null,
        etape_actuelle: m.status ? `${m.status.label} (${m.status.code})` : null,
        affecte_a: currentStep?.responsibleId ? names.get(currentStep.responsibleId) ?? null : null,
        etape_pre_validee: currentStep?.preValidatedAt ? "1re signature posée, en attente de contre-validation" : null,
        derniere_operation: lastValidated ? `${lastValidated.status.label} validée le ${lastValidated.validatedAt!.toISOString().slice(0, 10)}${lastValidated.validationBy ? ` par ${names.get(lastValidated.validationBy) ?? "?"}` : ""}` : "Aucune validation d'étape enregistrée",
        etapes_validees: steps.filter((s) => s.validatedAt).map((s) => `${s.status.label} (${s.validatedAt!.toISOString().slice(0, 10)})`),
        rapports_ia_disponibles: aiJobs.map((j) => j.workType),
        documents: docsOut,
      });
    }
    return JSON.stringify({ erreur: "Outil inconnu." });
  } catch {
    return JSON.stringify({ erreur: "La lecture du dossier a échoué." });
  }
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

    // Boucle de tool-calling : SAGE peut interroger l'ERP (rechercher / dossier)
    // ET le Web (recherche côté serveur Anthropic), puis répondre. Lecture seule ;
    // les documents rencontrés sont proposés au DG, les sources web sont citées.
    const docs = new Map<string, DocAttachment>();
    const webSources = new Map<string, WebSource>();
    const convo: { role: "user" | "assistant"; content: unknown }[] = messages.map((m) => ({ role: m.role, content: m.content }));
    const toolNames = new Set(SAGE_TOOLS.map((t) => t.name));
    // Dégradation gracieuse : si le modèle/clé ne supporte pas la recherche web,
    // le 1er appel échoue → on repasse SANS l'outil web pour le reste de la réponse.
    let webEnabled = true;
    const callModel = async (): Promise<{ content: unknown[]; stop_reason?: string | null }> => {
      const tools = webEnabled ? [...SAGE_TOOLS, WEB_SEARCH_TOOL] : SAGE_TOOLS;
      try {
        return await client.messages.create({ model: modelId, max_tokens: 4096, system, tools: tools as never, messages: convo as never });
      } catch (err) {
        if (webEnabled) { webEnabled = false; return await client.messages.create({ model: modelId, max_tokens: 4096, system, tools: SAGE_TOOLS as never, messages: convo as never }); }
        throw err;
      }
    };
    let finalText = "";
    for (let step = 0; step < 8; step++) {
      const resp = await callModel();
      const blocks = resp.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; content?: unknown }>;
      collectWebSources(blocks, webSources);
      finalText = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      // Recherche web serveur longue : la réponse peut être « en pause » → on la
      // relance en ré-empilant le contenu partiel (aucun outil client à exécuter).
      if (resp.stop_reason === "pause_turn") { convo.push({ role: "assistant", content: resp.content }); continue; }
      // On n'exécute QUE nos outils client (les outils serveur sont déjà traités).
      const toolUses = blocks.filter((b) => b.type === "tool_use" && toolNames.has(b.name ?? ""));
      if (toolUses.length === 0) break;
      convo.push({ role: "assistant", content: resp.content });
      const results = [];
      for (const tu of toolUses) {
        const out = await executeTool(tu.name ?? "", tu.input ?? {}, docs);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      convo.push({ role: "user", content: results });
    }

    // Traçabilité : liste des sources web consultées, ajoutée en pied de réponse.
    if (webSources.size > 0) {
      const list = [...webSources.values()].slice(0, 12).map((s) => `• ${s.title} — ${s.url}`).join("\n");
      finalText = `${finalText}\n\n— Sources consultées sur le Web —\n${list}`.trim();
    }

    await prisma.aiConversationMessage.update({
      where: { id: assistantMessageId },
      data: { content: finalText || "(réponse vide)", status: "done", model: modelId, attachments: docs.size ? [...docs.values()] : undefined },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de la réponse de SAGE.";
    await prisma.aiConversationMessage.update({ where: { id: assistantMessageId }, data: { status: "erreur", errorMessage: message } }).catch(() => {});
  }
}
