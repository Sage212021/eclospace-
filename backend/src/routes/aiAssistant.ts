import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyRole } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { runConversationReply } from "../lib/aiAssistant.js";

// Espace de dialogue privé DG ↔ SAGE (« Échanger avec SAGE »). Réservé à la
// Direction générale et à l'administrateur. Conversations LIBRES, privées par
// propriétaire (un DG ne voit que ses propres conversations). Fondation (Lot 1).
const SAGE_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL"];

function messageView(m: { id: string; role: string; content: string; status: string; errorMessage: string | null; createdAt: Date }) {
  return { id: m.id, role: m.role, content: m.content, status: m.status, error_message: m.errorMessage, created_at: m.createdAt };
}

export default async function aiAssistantRoutes(fastify: FastifyInstance) {
  // Liste des conversations du DG (non archivées), par dernière activité.
  fastify.get("/api/v1/sage/conversations", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const owner = request.user!.id;
    const convs = await prisma.aiConversation.findMany({
      where: { ownerId: owner, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: { where: { deletedAt: null } } } } },
    });
    return reply.send({
      conversations: convs.map((c) => ({ id: c.id, title: c.title, created_at: c.createdAt, updated_at: c.updatedAt, message_count: c._count.messages })),
    });
  });

  // Ouvrir une conversation (son historique). Réservé à son propriétaire.
  fastify.get("/api/v1/sage/conversations/:id", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const conv = await prisma.aiConversation.findFirst({ where: { id, ownerId: request.user!.id, archivedAt: null }, select: { id: true, title: true } });
    if (!conv) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const messages = await prisma.aiConversationMessage.findMany({ where: { conversationId: id, deletedAt: null }, orderBy: { createdAt: "asc" } });
    return reply.send({ id: conv.id, title: conv.title, messages: messages.map(messageView) });
  });

  // Créer une conversation ; un premier message peut être envoyé dans la foulée.
  const createSchema = z.object({ title: z.string().trim().max(200).optional(), content: z.string().trim().max(8000).optional() });
  fastify.post("/api/v1/sage/conversations", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Données invalides.", details: parsed.error.issues });
    const owner = request.user!.id;
    const title = parsed.data.title?.trim() || (parsed.data.content ? parsed.data.content.slice(0, 60) : "Nouvelle conversation");
    const conv = await prisma.aiConversation.create({ data: { ownerId: owner, title, createdBy: owner } });
    await writeAuditLog({ userId: owner, action: "create", entityType: "ai_conversation", entityId: conv.id, newValues: { title }, ipAddress: request.ip });

    let assistantMessageId: string | null = null;
    if (parsed.data.content) {
      await prisma.aiConversationMessage.create({ data: { conversationId: conv.id, role: "user", status: "done", content: parsed.data.content, createdBy: owner } });
      const assistant = await prisma.aiConversationMessage.create({ data: { conversationId: conv.id, role: "assistant", status: "pending", content: "", createdBy: owner } });
      assistantMessageId = assistant.id;
      void runConversationReply(assistant.id);
    }
    return reply.code(201).send({ id: conv.id, title: conv.title, assistant_message_id: assistantMessageId });
  });

  // Envoyer un message dans une conversation existante.
  const messageSchema = z.object({ content: z.string().trim().min(1).max(8000) });
  fastify.post("/api/v1/sage/conversations/:id/messages", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Message invalide.", details: parsed.error.issues });
    const conv = await prisma.aiConversation.findFirst({ where: { id, ownerId: request.user!.id, archivedAt: null }, select: { id: true } });
    if (!conv) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const already = await prisma.aiConversationMessage.findFirst({ where: { conversationId: id, status: "pending" }, select: { id: true } });
    if (already) return reply.code(409).send({ code: "already_running", message: "SAGE est en train de répondre. Patientez un instant." });

    const owner = request.user!.id;
    const userMessage = await prisma.aiConversationMessage.create({ data: { conversationId: id, role: "user", status: "done", content: parsed.data.content, createdBy: owner } });
    const assistant = await prisma.aiConversationMessage.create({ data: { conversationId: id, role: "assistant", status: "pending", content: "", createdBy: owner } });
    await prisma.aiConversation.update({ where: { id }, data: { updatedAt: new Date() } });
    await writeAuditLog({ userId: owner, action: "create", entityType: "ai_conversation_message", entityId: userMessage.id, newValues: { conversationId: id, role: "user" }, ipAddress: request.ip });
    void runConversationReply(assistant.id);
    return reply.code(202).send({ user_message_id: userMessage.id, assistant_message_id: assistant.id });
  });

  // Renommer une conversation (donner un titre).
  const renameSchema = z.object({ title: z.string().trim().min(1).max(200) });
  fastify.patch("/api/v1/sage/conversations/:id", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = renameSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Titre invalide.", details: parsed.error.issues });
    const conv = await prisma.aiConversation.findFirst({ where: { id, ownerId: request.user!.id, archivedAt: null }, select: { id: true } });
    if (!conv) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const updated = await prisma.aiConversation.update({ where: { id }, data: { title: parsed.data.title.trim() } });
    return reply.send({ id: updated.id, title: updated.title });
  });

  // ── Mémoire institutionnelle & éditoriale validée (Lot 3) ──────────────────
  // Base de connaissances PARTAGÉE de la maison, alimentée par la Direction et
  // consultée par SAGE. Non privée (connaissance officielle commune), persistante.
  const KNOWLEDGE_CATEGORIES = ["institution", "editorial", "procedure", "collection", "decision", "autre"] as const;

  fastify.get("/api/v1/sage/knowledge", { preHandler: requireAnyRole(SAGE_ROLES) }, async (_request, reply) => {
    const entries = await prisma.aiKnowledge.findMany({
      where: { deletedAt: null },
      orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
      select: { id: true, category: true, title: true, content: true, status: true, createdAt: true, updatedAt: true },
    });
    return reply.send({ entries });
  });

  const knowledgeSchema = z.object({
    category: z.enum(KNOWLEDGE_CATEGORIES).default("institution"),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(8000),
  });
  fastify.post("/api/v1/sage/knowledge", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const parsed = knowledgeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Fiche de connaissance invalide.", details: parsed.error.issues });
    const now = new Date();
    const entry = await prisma.aiKnowledge.create({
      data: { category: parsed.data.category, title: parsed.data.title.trim(), content: parsed.data.content.trim(), status: "validated", createdBy: request.user!.id, validatedBy: request.user!.id, validatedAt: now },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "ai_knowledge", entityId: entry.id, newValues: { category: entry.category, title: entry.title }, ipAddress: request.ip });
    return reply.code(201).send({ id: entry.id });
  });

  fastify.patch("/api/v1/sage/knowledge/:id", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = knowledgeSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Modification invalide.", details: parsed.error.issues });
    const existing = await prisma.aiKnowledge.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Fiche introuvable." });
    const updated = await prisma.aiKnowledge.update({
      where: { id },
      data: {
        ...(parsed.data.category ? { category: parsed.data.category } : {}),
        ...(parsed.data.title ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.content ? { content: parsed.data.content.trim() } : {}),
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "ai_knowledge", entityId: id, newValues: { category: updated.category, title: updated.title }, ipAddress: request.ip });
    return reply.send({ id: updated.id });
  });

  fastify.delete("/api/v1/sage/knowledge/:id", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.aiKnowledge.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Fiche introuvable." });
    await prisma.aiKnowledge.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "ai_knowledge", entityId: id, newValues: { deleted: true }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // Archiver (suppression logique) une conversation : elle quitte la liste.
  fastify.delete("/api/v1/sage/conversations/:id", { preHandler: requireAnyRole(SAGE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const conv = await prisma.aiConversation.findFirst({ where: { id, ownerId: request.user!.id, archivedAt: null }, select: { id: true } });
    if (!conv) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    await prisma.aiConversation.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "ai_conversation", entityId: id, newValues: { archived: true }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });
}
