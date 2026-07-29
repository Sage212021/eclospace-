import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuthor, requirePermission } from "../lib/permissions.js";
import { notifyUsers } from "../lib/notify.js";

// Messagerie auteur ↔ services (Espace Auteur inc. 2b). L'auteur écrit à un
// SERVICE (Éducation ou Client), pas à une personne ; un agent habilité
// (permission service_auteurs) répond. L'auteur ne voit que ses propres fils.

const SERVICE_LABELS: Record<string, string> = { education: "Service Éducation", client: "Service Client" };
const MAX_SUBJECT = 160;
const MAX_BODY = 4000;

// Agents habilités à traiter les messages des auteurs (pour les notifications).
async function serviceStaffIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      status: "active",
      deletedAt: null,
      accountType: "internal",
      userRoles: { some: { revokedAt: null, role: { rolePermissions: { some: { permission: { module: "service_auteurs", action: "consultation" } } } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function unreadByThread(threadIds: string[], since: Map<string, Date | null>, fromKind: "author" | "staff") {
  if (threadIds.length === 0) return new Map<string, number>();
  const rows = await prisma.serviceMessage.groupBy({
    by: ["threadId"],
    where: {
      threadId: { in: threadIds },
      senderKind: fromKind,
      OR: threadIds.map((id) => ({ threadId: id, createdAt: { gt: since.get(id) ?? new Date(0) } })),
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.threadId, r._count._all]));
}

export default async function serviceDeskRoutes(fastify: FastifyInstance) {
  // ── Côté auteur ────────────────────────────────────────────────────────────

  fastify.get("/api/v1/author/service-threads", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const threads = await prisma.serviceThread.findMany({ where: { partnerId }, orderBy: { lastMessageAt: "desc" } });
    const ids = threads.map((t) => t.id);
    const last = await prisma.serviceMessage.findMany({ where: { threadId: { in: ids } }, orderBy: { createdAt: "desc" }, distinct: ["threadId"], select: { threadId: true, body: true } });
    const lastByThread = new Map(last.map((m) => [m.threadId, m.body]));
    // Non-lus pour l'auteur : messages du personnel après sa dernière lecture.
    const unread = await unreadByThread(ids, new Map(threads.map((t) => [t.id, t.authorReadAt])), "staff");
    return reply.send(
      threads.map((t) => ({
        id: t.id,
        service: t.service,
        service_label: SERVICE_LABELS[t.service] ?? t.service,
        subject: t.subject,
        status: t.status,
        last_message: lastByThread.get(t.id) ?? "",
        last_at: t.lastMessageAt,
        unread: unread.get(t.id) ?? 0,
      })),
    );
  });

  fastify.post("/api/v1/author/service-threads", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const parsed = z
      .object({ service: z.enum(["education", "client"]), subject: z.string().min(1).max(MAX_SUBJECT), body: z.string().min(1).max(MAX_BODY) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Service, sujet et message sont requis." });
    const now = new Date();
    const thread = await prisma.$transaction(async (tx) => {
      const t = await tx.serviceThread.create({ data: { partnerId, service: parsed.data.service, subject: parsed.data.subject.trim(), lastMessageAt: now, authorReadAt: now } });
      await tx.serviceMessage.create({ data: { threadId: t.id, senderKind: "author", senderUserId: request.user!.id, body: parsed.data.body.trim() } });
      return t;
    });
    const staff = await serviceStaffIds();
    if (staff.length) {
      await notifyUsers({ userIds: staff, type: "autre", priority: "medium", title: `Message d'un auteur — ${SERVICE_LABELS[parsed.data.service]}`, body: thread.subject, entityType: "service_thread", entityId: thread.id }).catch(() => {});
    }
    return reply.code(201).send({ id: thread.id });
  });

  fastify.get("/api/v1/author/service-threads/:id", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const { id } = request.params as { id: string };
    const thread = await prisma.serviceThread.findFirst({ where: { id, partnerId } });
    if (!thread) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const messages = await prisma.serviceMessage.findMany({ where: { threadId: id }, orderBy: { createdAt: "asc" } });
    await prisma.serviceThread.update({ where: { id }, data: { authorReadAt: new Date() } });
    return reply.send({
      id: thread.id,
      service: thread.service,
      service_label: SERVICE_LABELS[thread.service] ?? thread.service,
      subject: thread.subject,
      status: thread.status,
      messages: messages.map((m) => ({ id: m.id, mine: m.senderKind === "author", from_service: m.senderKind === "staff", body: m.body, created_at: m.createdAt })),
    });
  });

  fastify.post("/api/v1/author/service-threads/:id/messages", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const { id } = request.params as { id: string };
    const parsed = z.object({ body: z.string().min(1).max(MAX_BODY) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Message vide." });
    const thread = await prisma.serviceThread.findFirst({ where: { id, partnerId } });
    if (!thread) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const now = new Date();
    await prisma.$transaction([
      prisma.serviceMessage.create({ data: { threadId: id, senderKind: "author", senderUserId: request.user!.id, body: parsed.data.body.trim() } }),
      prisma.serviceThread.update({ where: { id }, data: { lastMessageAt: now, authorReadAt: now } }),
    ]);
    const staff = await serviceStaffIds();
    if (staff.length) {
      await notifyUsers({ userIds: staff, type: "autre", priority: "medium", title: `Réponse d'un auteur — ${SERVICE_LABELS[thread.service]}`, body: thread.subject, entityType: "service_thread", entityId: id }).catch(() => {});
    }
    return reply.code(201).send({ ok: true });
  });

  // ── Côté personnel (guichets) ───────────────────────────────────────────────

  fastify.get("/api/v1/service-threads", { preHandler: requirePermission("service_auteurs", "consultation") }, async (request, reply) => {
    const q = z.object({ service: z.enum(["education", "client"]).optional() }).safeParse(request.query);
    const service = q.success ? q.data.service : undefined;
    const threads = await prisma.serviceThread.findMany({ where: service ? { service } : {}, orderBy: { lastMessageAt: "desc" }, take: 200 });
    const ids = threads.map((t) => t.id);
    const partnerIds = [...new Set(threads.map((t) => t.partnerId))];
    const [partners, last] = await Promise.all([
      prisma.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, firstName: true, lastName: true, penName: true } }),
      prisma.serviceMessage.findMany({ where: { threadId: { in: ids } }, orderBy: { createdAt: "desc" }, distinct: ["threadId"], select: { threadId: true, body: true } }),
    ]);
    const nameById = new Map(partners.map((p) => [p.id, p.penName || `${p.firstName} ${p.lastName}`.trim()]));
    const lastByThread = new Map(last.map((m) => [m.threadId, m.body]));
    // Non-lus pour le personnel : messages de l'auteur après la dernière lecture.
    const unread = await unreadByThread(ids, new Map(threads.map((t) => [t.id, t.staffReadAt])), "author");
    return reply.send(
      threads.map((t) => ({
        id: t.id,
        service: t.service,
        service_label: SERVICE_LABELS[t.service] ?? t.service,
        subject: t.subject,
        status: t.status,
        author_name: nameById.get(t.partnerId) ?? "—",
        last_message: lastByThread.get(t.id) ?? "",
        last_at: t.lastMessageAt,
        unread: unread.get(t.id) ?? 0,
      })),
    );
  });

  fastify.get("/api/v1/service-threads/:id", { preHandler: requirePermission("service_auteurs", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = await prisma.serviceThread.findUnique({ where: { id } });
    if (!thread) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const partner = await prisma.partner.findUnique({ where: { id: thread.partnerId }, select: { firstName: true, lastName: true, penName: true } });
    const messages = await prisma.serviceMessage.findMany({ where: { threadId: id }, orderBy: { createdAt: "asc" } });
    await prisma.serviceThread.update({ where: { id }, data: { staffReadAt: new Date() } });
    return reply.send({
      id: thread.id,
      service: thread.service,
      service_label: SERVICE_LABELS[thread.service] ?? thread.service,
      subject: thread.subject,
      status: thread.status,
      author_name: partner ? partner.penName || `${partner.firstName} ${partner.lastName}`.trim() : "—",
      messages: messages.map((m) => ({ id: m.id, from_service: m.senderKind === "staff", from_author: m.senderKind === "author", body: m.body, created_at: m.createdAt })),
    });
  });

  fastify.post("/api/v1/service-threads/:id/messages", { preHandler: requirePermission("service_auteurs", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ body: z.string().min(1).max(MAX_BODY) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Message vide." });
    const thread = await prisma.serviceThread.findUnique({ where: { id } });
    if (!thread) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const now = new Date();
    await prisma.$transaction([
      prisma.serviceMessage.create({ data: { threadId: id, senderKind: "staff", senderUserId: request.user!.id, body: parsed.data.body.trim() } }),
      prisma.serviceThread.update({ where: { id }, data: { lastMessageAt: now, staffReadAt: now } }),
    ]);
    // Prévient l'auteur (si son compte existe) d'une réponse du service.
    const account = await prisma.user.findFirst({ where: { partnerId: thread.partnerId, accountType: "external", status: "active", deletedAt: null }, select: { id: true } });
    if (account) {
      await notifyUsers({ userIds: [account.id], type: "autre", priority: "medium", title: `Réponse — ${SERVICE_LABELS[thread.service]}`, body: thread.subject, entityType: "service_thread", entityId: id }).catch(() => {});
    }
    return reply.code(201).send({ ok: true });
  });
}
