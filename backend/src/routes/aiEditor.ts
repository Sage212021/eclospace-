import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyRole } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { runEditorAnswer } from "../lib/aiEditor.js";

// ÉCLOSION ÉDITORIAL IA — Lot A (lecture + diagnostic + dialogue). Réservé à la
// Direction générale et à l'administrateur (ouverture au directeur éditorial
// plus tard = ajouter son rôle ici). Ne porte QUE sur des ouvrages enregistrés
// dans Eclospace. Chaque action est journalisée (journal d'audit) et chaque
// message est conservé et horodaté (table ai_editorial_messages).
const EDITOR_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL"];

function messageView(m: {
  id: string; kind: string; role: string; content: string; status: string; errorMessage: string | null; createdAt: Date; createdBy: string | null;
}) {
  return { id: m.id, kind: m.kind, role: m.role, content: m.content, status: m.status, error_message: m.errorMessage, created_at: m.createdAt, created_by: m.createdBy };
}

export default async function aiEditorRoutes(fastify: FastifyInstance) {
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
    const [manuscriptDoc, evalReport, messages] = await Promise.all([
      prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category: "manuscrit", deletedAt: null }, select: { id: true } }),
      prisma.aiReadingJob.findFirst({ where: { manuscriptId, workType: "evaluation", status: "termine", reportText: { not: null } }, select: { id: true } }),
      prisma.aiEditorialMessage.findMany({ where: { manuscriptId }, orderBy: { createdAt: "asc" } }),
    ]);

    return reply.send({
      manuscript: { id: manuscript.id, number: manuscript.manuscriptNumber, title: manuscript.title, genre: manuscript.genre?.label ?? null },
      sources: { has_manuscript_file: !!manuscriptDoc, has_evaluation_report: !!evalReport },
      messages: messages.map(messageView),
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
}
