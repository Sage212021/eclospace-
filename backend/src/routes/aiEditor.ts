import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyRole } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { runEditorAnswer, runRewrite, REWRITE_MODES, assembleChapterText } from "../lib/aiEditor.js";

// ÉCLOSION ÉDITORIAL IA — Lot A (lecture + diagnostic + dialogue). Réservé à la
// Direction générale et à l'administrateur (ouverture au directeur éditorial
// plus tard = ajouter son rôle ici). Ne porte QUE sur des ouvrages enregistrés
// dans Eclospace. Chaque action est journalisée (journal d'audit) et chaque
// message est conservé et horodaté (table ai_editorial_messages).
const EDITOR_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL"];

// Libellés lisibles des natures d'intervention (pour le journal éditorial).
const KIND_LABEL: Record<string, string> = {
  diagnostic: "Diagnostic éditorial",
  chat: "Dialogue",
  coherence: "Analyse de cohérence",
  impact: "Conséquences d'une modification",
  documentaire: "Vérification documentaire",
  traduction: "Traduction",
  fiche_lecture: "Fiche de lecture",
  presentation: "Textes de présentation",
  lettre_auteur: "Lettre à l'auteur",
  copyedit: "Préparation de copie",
  bibliographie: "Contrôle bibliographique",
  typographie: "Contrôle typographique",
};
const REWRITE_MODE_LABEL: Record<string, string> = { fidele: "fidèle à l'auteur", renforce: "littérairement renforcé", alternatif: "proposition alternative" };

function messageView(m: {
  id: string; kind: string; role: string; content: string; status: string; errorMessage: string | null; createdAt: Date; createdBy: string | null;
}) {
  return { id: m.id, kind: m.kind, role: m.role, content: m.content, status: m.status, error_message: m.errorMessage, created_at: m.createdAt, created_by: m.createdBy };
}

export default async function aiEditorRoutes(fastify: FastifyInstance) {
  // Liste des CONVERSATIONS existantes (une par ouvrage) — le « menu interne »
  // pour naviguer entre les manuscrits sans tout re-chercher. Classé par
  // dernière activité. Un ouvrage apparaît ici dès qu'il a ≥ 1 échange SAGE.
  fastify.get("/api/v1/ai-editor", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (_request, reply) => {
    const groups = await prisma.aiEditorialMessage.groupBy({
      by: ["manuscriptId"],
      where: { deletedAt: null },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    if (groups.length === 0) return reply.send({ conversations: [] });
    const manuscripts = await prisma.manuscript.findMany({
      where: { id: { in: groups.map((g) => g.manuscriptId) }, deletedAt: null },
      select: { id: true, manuscriptNumber: true, title: true },
    });
    const byId = new Map(manuscripts.map((m) => [m.id, m]));
    const conversations = groups
      .map((g) => {
        const m = byId.get(g.manuscriptId);
        if (!m) return null;
        return { manuscript_id: m.id, number: m.manuscriptNumber, title: m.title, message_count: g._count._all, last_activity: g._max.createdAt };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => (b.last_activity?.getTime() ?? 0) - (a.last_activity?.getTime() ?? 0));
    return reply.send({ conversations });
  });

  // État du dossier éditorial d'un ouvrage : fiche, disponibilité des sources
  // (manuscrit + rapport), et l'historique complet des échanges.
  fastify.get("/api/v1/ai-editor/:manuscriptId", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const manuscript = await prisma.manuscript.findFirst({
      where: { id: manuscriptId, deletedAt: null },
      select: { id: true, manuscriptNumber: true, title: true, genre: { select: { label: true } } },
    });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });

    // Sources déjà présentes dans l'ERP.
    const [manuscriptDoc, evalReport, messages, passageCount, chapterGroups, rewrites] = await Promise.all([
      prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null }, select: { id: true } }),
      prisma.aiReadingJob.findFirst({ where: { manuscriptId, workType: "evaluation", status: "termine", reportText: { not: null } }, select: { id: true } }),
      prisma.aiEditorialMessage.findMany({ where: { manuscriptId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
      prisma.aiEditorialPassage.count({ where: { manuscriptId } }),
      // Chapitres détectés lors de l'indexation (pour la préparation de copie
      // chapitre par chapitre). Ordonnés par position dans l'ouvrage.
      prisma.aiEditorialPassage.groupBy({ by: ["chapterLabel"], where: { manuscriptId, chapterLabel: { not: null } }, _min: { ordinal: true } }),
      prisma.aiEditorialRewrite.findMany({ where: { manuscriptId }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    const chapters = chapterGroups
      .filter((g) => g.chapterLabel)
      .sort((a, b) => (a._min.ordinal ?? 0) - (b._min.ordinal ?? 0))
      .map((g) => g.chapterLabel as string);

    return reply.send({
      manuscript: { id: manuscript.id, number: manuscript.manuscriptNumber, title: manuscript.title, genre: manuscript.genre?.label ?? null },
      sources: { has_manuscript_file: !!manuscriptDoc, has_evaluation_report: !!evalReport },
      memory: { passage_count: passageCount },
      chapters,
      messages: messages.map(messageView),
      rewrites: rewrites.map((r) => ({
        id: r.id, mode: r.mode, instruction: r.instruction, source_text: r.sourceText, proposed_text: r.proposedText,
        explanation: r.explanation, status: r.status, error_message: r.errorMessage, created_at: r.createdAt, decided_at: r.decidedAt,
      })),
    });
  });

  // Lancer (ou relancer) le DIAGNOSTIC éditorial. Crée un message « assistant »
  // en attente, puis l'exécute en arrière-plan (évite les coupures sur longue
  // analyse). Refusé si aucun manuscrit n'est déposé.
  fastify.post("/api/v1/ai-editor/:manuscriptId/diagnose", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
    const manuscriptDoc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null }, select: { id: true } });
    if (!manuscriptDoc) {
      return reply.code(409).send({ code: "no_manuscript_file", message: "Aucun manuscrit n'est déposé pour cet ouvrage : déposez-le d'abord dans la fiche." });
    }
    const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "Une analyse est déjà en cours pour cet ouvrage. Patientez quelques instants." });

    const assistant = await prisma.aiEditorialMessage.create({
      data: { manuscriptId, kind: "diagnostic", role: "assistant", status: "pending", content: "", createdBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: assistant.id, newValues: { manuscriptId, kind: "diagnostic" }, ipAddress: request.ip });
    void runEditorAnswer(assistant.id);
    return reply.code(202).send({ message_id: assistant.id });
  });

  // Poser une question / demander une analyse : enregistre le message de
  // l'opérateur + un message « assistant » en attente, puis exécute en fond.
  const messageSchema = z.object({ content: z.string().trim().min(1).max(8000) });
  fastify.post("/api/v1/ai-editor/:manuscriptId/message", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Message invalide.", details: parsed.error.issues });
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
    const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "Une réponse est déjà en cours pour cet ouvrage. Patientez quelques instants." });

    const userMessage = await prisma.aiEditorialMessage.create({
      data: { manuscriptId, kind: "chat", role: "user", status: "done", content: parsed.data.content, createdBy: request.user!.id },
    });
    const assistant = await prisma.aiEditorialMessage.create({
      data: { manuscriptId, kind: "chat", role: "assistant", status: "pending", content: "", createdBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: userMessage.id, newValues: { manuscriptId, kind: "chat", role: "user" }, ipAddress: request.ip });
    void runEditorAnswer(assistant.id);
    return reply.code(202).send({ user_message_id: userMessage.id, assistant_message_id: assistant.id });
  });

  // Analyse de COHÉRENCE : contradictions, répétitions, ruptures (vue
  // d'ensemble). Exécution en arrière-plan.
  fastify.post("/api/v1/ai-editor/:manuscriptId/coherence", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
    const manuscriptDoc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null }, select: { id: true } });
    if (!manuscriptDoc) return reply.code(409).send({ code: "no_manuscript_file", message: "Aucun manuscrit n'est déposé pour cet ouvrage." });
    const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "Une analyse est déjà en cours pour cet ouvrage." });
    const assistant = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "coherence", role: "assistant", status: "pending", content: "", createdBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: assistant.id, newValues: { manuscriptId, kind: "coherence" }, ipAddress: request.ip });
    void runEditorAnswer(assistant.id);
    return reply.code(202).send({ message_id: assistant.id });
  });

  // Conséquences d'une MODIFICATION : l'opérateur décrit un changement, SAGE
  // repère les passages qui deviendraient incohérents. Exécution en fond.
  const impactSchema = z.object({ change: z.string().trim().min(1).max(4000) });
  fastify.post("/api/v1/ai-editor/:manuscriptId/impact", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const parsed = impactSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Décrivez la modification envisagée.", details: parsed.error.issues });
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
    const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "Une analyse est déjà en cours pour cet ouvrage." });
    const userMessage = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "impact", role: "user", status: "done", content: parsed.data.change, createdBy: request.user!.id } });
    const assistant = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "impact", role: "assistant", status: "pending", content: "", createdBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: userMessage.id, newValues: { manuscriptId, kind: "impact", role: "user" }, ipAddress: request.ip });
    void runEditorAnswer(assistant.id);
    return reply.code(202).send({ user_message_id: userMessage.id, assistant_message_id: assistant.id });
  });

  // Vérification DOCUMENTAIRE (sources, faits/opinions/hypothèses, références à
  // vérifier). Vue d'ensemble. Exécution en arrière-plan.
  fastify.post("/api/v1/ai-editor/:manuscriptId/documentaire", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
    const manuscriptDoc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null }, select: { id: true } });
    if (!manuscriptDoc) return reply.code(409).send({ code: "no_manuscript_file", message: "Aucun manuscrit n'est déposé pour cet ouvrage." });
    const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "Une analyse est déjà en cours pour cet ouvrage." });
    const assistant = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "documentaire", role: "assistant", status: "pending", content: "", createdBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: assistant.id, newValues: { manuscriptId, kind: "documentaire" }, ipAddress: request.ip });
    void runEditorAnswer(assistant.id);
    return reply.code(202).send({ message_id: assistant.id });
  });

  // ── Livrables éditoriaux (Lot F) : fiche de lecture, textes de présentation,
  // lettre à l'auteur. Même patron que coherence/documentaire : un seul message
  // « assistant » en attente, exécution en arrière-plan, manuscrit requis.
  const deliverableKinds = ["fiche_lecture", "presentation", "lettre_auteur"] as const;
  for (const kind of deliverableKinds) {
    fastify.post(`/api/v1/ai-editor/:manuscriptId/${kind.replace("_", "-")}`, { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
      const { manuscriptId } = request.params as { manuscriptId: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
      const manuscriptDoc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null }, select: { id: true } });
      if (!manuscriptDoc) return reply.code(409).send({ code: "no_manuscript_file", message: "Aucun manuscrit n'est déposé pour cet ouvrage : déposez-le d'abord dans la fiche." });
      const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
      if (already) return reply.code(409).send({ code: "already_running", message: "Une production est déjà en cours pour cet ouvrage. Patientez quelques instants." });
      const assistant = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind, role: "assistant", status: "pending", content: "", createdBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: assistant.id, newValues: { manuscriptId, kind }, ipAddress: request.ip });
      void runEditorAnswer(assistant.id);
      return reply.code(202).send({ message_id: assistant.id });
    });
  }

  // ── Préparation de copie & normes (Lot G) : contrôle bibliographique et
  // contrôle typographique — vues d'ensemble, même patron que documentaire.
  const normKinds = ["bibliographie", "typographie"] as const;
  for (const kind of normKinds) {
    fastify.post(`/api/v1/ai-editor/:manuscriptId/${kind}`, { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
      const { manuscriptId } = request.params as { manuscriptId: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
      const manuscriptDoc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null }, select: { id: true } });
      if (!manuscriptDoc) return reply.code(409).send({ code: "no_manuscript_file", message: "Aucun manuscrit n'est déposé pour cet ouvrage : déposez-le d'abord dans la fiche." });
      const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
      if (already) return reply.code(409).send({ code: "already_running", message: "Une analyse est déjà en cours pour cet ouvrage. Patientez quelques instants." });
      const assistant = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind, role: "assistant", status: "pending", content: "", createdBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: assistant.id, newValues: { manuscriptId, kind }, ipAddress: request.ip });
      void runEditorAnswer(assistant.id);
      return reply.code(202).send({ message_id: assistant.id });
    });
  }

  // PRÉPARATION DE COPIE d'un chapitre (ou d'un passage collé) : texte corrigé +
  // liste des corrections classées + niveau d'intervention. Le texte à préparer
  // est assemblé ici (chapitre indexé) ou fourni directement, puis conservé dans
  // le message « user » ; la préparation s'exécute en arrière-plan.
  const copyeditSchema = z.object({
    chapter: z.string().trim().min(1).max(200).optional(),
    source_text: z.string().trim().min(1).max(24000).optional(),
  }).refine((v) => v.chapter || v.source_text, { message: "Indiquez un chapitre ou collez un texte." });
  fastify.post("/api/v1/ai-editor/:manuscriptId/copyedit", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const parsed = copyeditSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Indiquez un chapitre ou collez un texte à préparer.", details: parsed.error.issues });
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
    const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "Une préparation est déjà en cours pour cet ouvrage. Patientez quelques instants." });

    // Assemble le texte : soit le chapitre indexé choisi, soit le passage collé.
    let text = parsed.data.source_text?.trim() ?? "";
    let label = "passage collé";
    if (parsed.data.chapter) {
      text = await assembleChapterText(manuscriptId, parsed.data.chapter);
      if (!text) return reply.code(409).send({ code: "chapter_not_found", message: "Ce chapitre n'a pas été retrouvé dans le manuscrit indexé. Lancez d'abord le diagnostic (qui indexe l'ouvrage), ou collez directement le texte à préparer." });
      label = parsed.data.chapter;
    }
    const userContent = `Préparation de copie — ${label}\n\n${text}`;
    const userMessage = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "copyedit", role: "user", status: "done", content: userContent, createdBy: request.user!.id } });
    const assistant = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "copyedit", role: "assistant", status: "pending", content: "", createdBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: userMessage.id, newValues: { manuscriptId, kind: "copyedit", chapter: parsed.data.chapter ?? null }, ipAddress: request.ip });
    void runEditorAnswer(assistant.id);
    return reply.code(202).send({ user_message_id: userMessage.id, assistant_message_id: assistant.id });
  });

  // TRADUCTION fidèle d'un passage (français ↔ anglais). Le passage + la langue
  // cible sont conservés dans le message « user » ; la traduction en fond.
  const translateSchema = z.object({ source_text: z.string().trim().min(1).max(20000), target_lang: z.enum(["fr", "en"]) });
  fastify.post("/api/v1/ai-editor/:manuscriptId/translate", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const parsed = translateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Indiquez le passage et la langue cible.", details: parsed.error.issues });
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });
    const already = await prisma.aiEditorialMessage.findFirst({ where: { manuscriptId, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "Une traduction est déjà en cours pour cet ouvrage." });
    const langLabel = parsed.data.target_lang === "en" ? "anglais" : "français";
    const userContent = `Langue cible : ${langLabel}\n\n${parsed.data.source_text}`;
    const userMessage = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "traduction", role: "user", status: "done", content: userContent, createdBy: request.user!.id } });
    const assistant = await prisma.aiEditorialMessage.create({ data: { manuscriptId, kind: "traduction", role: "assistant", status: "pending", content: "", createdBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_message", entityId: userMessage.id, newValues: { manuscriptId, kind: "traduction", target_lang: parsed.data.target_lang }, ipAddress: request.ip });
    void runEditorAnswer(assistant.id);
    return reply.code(202).send({ user_message_id: userMessage.id, assistant_message_id: assistant.id });
  });

  // Atelier de réécriture : proposer une réécriture d'un passage dans un mode
  // donné. L'original fourni est conservé ; la proposition est tracée. Exécution
  // en arrière-plan (comme le dialogue).
  const rewriteSchema = z.object({
    mode: z.enum(REWRITE_MODES),
    source_text: z.string().trim().min(1).max(20000),
    instruction: z.string().trim().max(2000).optional(),
  });
  fastify.post("/api/v1/ai-editor/:manuscriptId/rewrite", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const parsed = rewriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Demande de réécriture invalide.", details: parsed.error.issues });
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });

    const rw = await prisma.aiEditorialRewrite.create({
      data: { manuscriptId, mode: parsed.data.mode, instruction: parsed.data.instruction ?? null, sourceText: parsed.data.source_text, status: "pending", createdBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_editorial_rewrite", entityId: rw.id, newValues: { manuscriptId, mode: parsed.data.mode }, ipAddress: request.ip });
    void runRewrite(rw.id);
    return reply.code(202).send({ rewrite_id: rw.id });
  });

  // Décision sur une proposition : acceptée ou refusée. N'applique RIEN au
  // manuscrit de référence (l'original est préservé) — elle trace la décision.
  const decisionSchema = z.object({ decision: z.enum(["accepted", "rejected"]) });
  fastify.post("/api/v1/ai-editor/rewrites/:rewriteId/decision", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { rewriteId } = request.params as { rewriteId: string };
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Décision invalide.", details: parsed.error.issues });
    const rw = await prisma.aiEditorialRewrite.findUnique({ where: { id: rewriteId } });
    if (!rw) return reply.code(404).send({ code: "not_found", message: "Proposition introuvable." });
    if (rw.status !== "done" && rw.status !== "accepted" && rw.status !== "rejected") {
      return reply.code(409).send({ code: "not_decidable", message: "Cette proposition n'est pas encore prête (ou a échoué)." });
    }
    const updated = await prisma.aiEditorialRewrite.update({
      where: { id: rewriteId },
      data: { status: parsed.data.decision, decidedBy: request.user!.id, decidedAt: new Date() },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "ai_editorial_rewrite", entityId: rewriteId, newValues: { decision: parsed.data.decision }, ipAddress: request.ip });
    return reply.send({ id: updated.id, status: updated.status });
  });

  // JOURNAL ÉDITORIAL de l'ouvrage : historique LISIBLE de tout mouvement de
  // SAGE (demandes, analyses, livrables, réécritures et leurs décisions,
  // préparations de copie, suppressions). Construit en lecture seule à partir
  // des données déjà tracées — y compris les messages supprimés (on montre la
  // suppression comme un mouvement, sans ré-exposer le contenu effacé).
  fastify.get("/api/v1/ai-editor/:manuscriptId/journal", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { manuscriptId } = request.params as { manuscriptId: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id: manuscriptId, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable dans Eclospace." });

    const [messages, rewrites] = await Promise.all([
      prisma.aiEditorialMessage.findMany({ where: { manuscriptId }, orderBy: { createdAt: "asc" } }),
      prisma.aiEditorialRewrite.findMany({ where: { manuscriptId }, orderBy: { createdAt: "asc" } }),
    ]);

    const ids = new Set<string>();
    for (const m of messages) { if (m.createdBy) ids.add(m.createdBy); if (m.deletedBy) ids.add(m.deletedBy); }
    for (const r of rewrites) { if (r.createdBy) ids.add(r.createdBy); if (r.decidedBy) ids.add(r.decidedBy); }
    const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, username: true } }) : [];
    const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.username ?? null : null);
    const excerpt = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > 140 ? `${t.slice(0, 140)}…` : t; };

    type Event = { at: string; kind: string; label: string; actor: string | null; status: string | null; detail: string | null };
    const events: Event[] = [];
    for (const m of messages) {
      const kindLabel = KIND_LABEL[m.kind] ?? m.kind;
      if (m.role === "user") {
        // La préparation de copie range l'étiquette (« Préparation… — chapitre »)
        // en 1re ligne : on la met en détail plutôt que l'extrait du texte.
        const detail = m.kind === "copyedit" ? m.content.split("\n")[0] : excerpt(m.content);
        events.push({ at: m.createdAt.toISOString(), kind: m.kind, label: `Demande : ${kindLabel}`, actor: nameOf(m.createdBy), status: null, detail });
      } else {
        events.push({ at: m.createdAt.toISOString(), kind: m.kind, label: kindLabel, actor: nameOf(m.createdBy), status: m.status, detail: null });
      }
      if (m.deletedAt) {
        events.push({ at: m.deletedAt.toISOString(), kind: "suppression", label: `Message supprimé (${kindLabel})`, actor: nameOf(m.deletedBy), status: null, detail: null });
      }
    }
    for (const r of rewrites) {
      const mode = REWRITE_MODE_LABEL[r.mode] ?? r.mode;
      events.push({ at: r.createdAt.toISOString(), kind: "reecriture", label: `Proposition de réécriture — ${mode}`, actor: nameOf(r.createdBy), status: r.status, detail: r.instruction ? excerpt(r.instruction) : null });
      if (r.decidedAt && (r.status === "accepted" || r.status === "rejected")) {
        events.push({ at: r.decidedAt.toISOString(), kind: "reecriture_decision", label: `Réécriture ${r.status === "accepted" ? "acceptée" : "refusée"}`, actor: nameOf(r.decidedBy), status: r.status, detail: null });
      }
    }
    events.sort((a, b) => a.at.localeCompare(b.at));
    return reply.send({ events });
  });

  // Supprimer (logiquement) un message du tchat. Le message est masqué de
  // l'historique et du contexte ; il n'est jamais effacé physiquement (§13).
  fastify.delete("/api/v1/ai-editor/messages/:messageId", { preHandler: requireAnyRole(EDITOR_ROLES) }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const msg = await prisma.aiEditorialMessage.findUnique({ where: { id: messageId }, select: { id: true, deletedAt: true } });
    if (!msg) return reply.code(404).send({ code: "not_found", message: "Message introuvable." });
    if (!msg.deletedAt) {
      await prisma.aiEditorialMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "ai_editorial_message", entityId: messageId, newValues: { deleted: true }, ipAddress: request.ip });
    }
    return reply.send({ ok: true });
  });
}
