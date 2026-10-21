import { prisma } from "./prisma.js";
import { loadConfig, readApiKey, resolveModelId } from "./aiConfig.js";

// SAGE — moteur d'APPRENTISSAGE sous contrôle (Lot 4). SAGE relit les échanges
// récents du DG, repère les questions récurrentes et ses lacunes, et PROPOSE des
// fiches de connaissance (statut « pending ») que le DG valide. Rien n'entre dans
// la mémoire officielle sans validation ; SAGE n'invente aucun fait.

const LEARNING_SYSTEM = `Tu es SAGE, l'éditeur de la maison Éclosion Édition. On te confie une tâche d'AMÉLIORATION : relis les échanges récents entre le directeur général et toi, et aide la maison à mieux documenter ses connaissances.

Tu dois produire trois choses :
1) RÉCURRENCES : les sujets ou questions qui reviennent souvent et mériteraient une explication de référence.
2) LACUNES : les points sur lesquels tu as manqué d'une information fiable (ce que la maison gagnerait à préciser), sans jamais inventer la réponse.
3) PROPOSITIONS : des fiches de connaissance à AJOUTER à la mémoire de la maison, UNIQUEMENT lorsqu'une information fiable ressort clairement des échanges (par exemple une décision explicitement prise par le DG, une règle qu'il a énoncée). Tu ne proposes JAMAIS une fiche inventée, ni un tarif / une règle / une décision qui n'a pas été clairement affirmé par le DG. S'il n'y a rien de solide à retenir, renvoie une liste vide.

Chaque proposition est prudente et fidèle : son contenu ne dépasse pas ce qui a été réellement dit. Les décisions proposées restent « à valider » — elles ne deviennent officielles que si le DG les accepte.

Réponds STRICTEMENT par un objet JSON valide, sans aucun texte autour, de la forme :
{"recurrent":["…"],"lacunes":["…"],"propositions":[{"category":"institution|editorial|procedure|collection|decision|autre","title":"…","content":"…","rationale":"pourquoi cette fiche, d'après les échanges"}]}`;

const CATEGORIES = new Set(["institution", "editorial", "procedure", "collection", "decision", "autre"]);
const MAX_MESSAGES = 60;
const MAX_PROPOSALS = 12;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Exécution en arrière-plan. Ne lève JAMAIS : toute erreur est consignée sur le run.
export async function runLearningAnalysis(runId: string): Promise<void> {
  try {
    const run = await prisma.aiLearningRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "pending") return;
    const owner = run.ownerId;

    const cfg = await loadConfig();
    const apiKey = readApiKey(cfg);
    if (!cfg.enabled || !apiKey) {
      await prisma.aiLearningRun.update({ where: { id: runId }, data: { status: "erreur", errorMessage: "SAGE n'est pas activé (clé API manquante)." } }).catch(() => {});
      return;
    }

    const convs = await prisma.aiConversation.findMany({ where: { ownerId: owner, archivedAt: null }, select: { id: true } });
    const convIds = convs.map((c) => c.id);
    const recent = convIds.length
      ? await prisma.aiConversationMessage.findMany({ where: { conversationId: { in: convIds }, status: "done", deletedAt: null }, orderBy: { createdAt: "desc" }, take: MAX_MESSAGES })
      : [];
    if (recent.length === 0) {
      await prisma.aiLearningRun.update({ where: { id: runId }, data: { status: "done", summary: "Pas encore assez d'échanges pour en tirer des enseignements. Dialoguez avec SAGE, puis relancez l'analyse.", proposalCount: 0 } });
      return;
    }
    const transcript = recent.reverse().map((m) => `${m.role === "user" ? "DG" : "SAGE"} : ${m.content}`).join("\n\n").slice(0, 60000);

    const existing = await prisma.aiKnowledge.findMany({ where: { deletedAt: null, status: { in: ["validated", "pending"] } }, select: { title: true } });
    const existingList = existing.map((e) => `- ${e.title}`).join("\n") || "(aucune)";

    const modelId = resolveModelId(cfg.models.reecriture ?? "intermediaire");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: modelId,
      max_tokens: 3000,
      system: LEARNING_SYSTEM,
      messages: [{ role: "user", content: `ÉCHANGES RÉCENTS (DG ↔ SAGE) :\n${transcript}\n\nFICHES DÉJÀ PRÉSENTES (ne pas redoubler) :\n${existingList}\n\nProduis le JSON demandé.` }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("\n").trim();
    const parsed = extractJson(text) as { recurrent?: unknown; lacunes?: unknown; propositions?: unknown } | null;

    const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : []);
    const recurrent = parsed ? asStrings(parsed.recurrent) : [];
    const lacunes = parsed ? asStrings(parsed.lacunes) : [];
    const propositions = parsed && Array.isArray(parsed.propositions) ? (parsed.propositions as unknown[]).slice(0, MAX_PROPOSALS) : [];

    let created = 0;
    for (const p of propositions) {
      const o = p as { category?: unknown; title?: unknown; content?: unknown; rationale?: unknown };
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const content = typeof o.content === "string" ? o.content.trim() : "";
      if (!title || !content) continue;
      const category = typeof o.category === "string" && CATEGORIES.has(o.category) ? o.category : "autre";
      const rationale = typeof o.rationale === "string" ? o.rationale.trim() : null;
      await prisma.aiKnowledge.create({ data: { category, title: title.slice(0, 200), content: content.slice(0, 8000), status: "pending", source: "sage", rationale, createdBy: owner } });
      created++;
    }

    const parts: string[] = [];
    if (recurrent.length) parts.push(`Questions récurrentes :\n${recurrent.map((r) => `• ${r}`).join("\n")}`);
    if (lacunes.length) parts.push(`Lacunes à combler :\n${lacunes.map((l) => `• ${l}`).join("\n")}`);
    if (created > 0) parts.push(`${created} proposition(s) de fiche à valider ci-dessous.`);
    const summary = parts.join("\n\n") || "Rien de nouveau à proposer pour l'instant : SAGE n'a pas trouvé d'information fiable à retenir dans ces échanges.";

    await prisma.aiLearningRun.update({ where: { id: runId }, data: { status: "done", summary, proposalCount: created } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de l'analyse d'apprentissage.";
    await prisma.aiLearningRun.update({ where: { id: runId }, data: { status: "erreur", errorMessage: message } }).catch(() => {});
  }
}
