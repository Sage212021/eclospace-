import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { emitToUsers } from "../lib/realtime.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import { getOrCreateConversation, otherOf, isParticipant } from "../lib/chat.js";

// Messagerie interne 1-à-1 (demande opérateur du 25/07/2026). Annuaire ouvert
// (chacun écrit à tout le monde), présence masquée hors pôle (règle existante,
// non touchée ici). Messages privés entre les deux participants ; la Direction
// générale (direction:consultation) peut consulter au besoin, chaque accès à une
// conversation dont elle n'est pas membre étant tracé au journal d'audit.

const MAX_BODY = 4000;

function messageView(m: { id: string; conversationId: string; senderId: string; body: string; fileName: string | null; fileMime: string | null; fileSize: number | null; createdAt: Date; deletedAt: Date | null }, senderName: string, me: string) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_id: m.senderId,
    sender_name: senderName,
    mine: m.senderId === me,
    body: m.deletedAt ? "" : m.body,
    deleted: Boolean(m.deletedAt),
    created_at: m.createdAt,
    file: m.deletedAt || !m.fileName ? null : { name: m.fileName, mime: m.fileMime, size: m.fileSize },
  };
}

export default async function chatRoutes(fastify: FastifyInstance) {
  // Annuaire : tous les collègues actifs (hors soi), sans indicateur « en ligne ».
  fastify.get("/api/v1/chat/directory", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const users = await prisma.user.findMany({
      where: { status: "active", deletedAt: null, id: { not: me } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
    return reply.send(users.map((u) => ({ id: u.id, name: u.username })));
  });

  // Mes conversations : correspondant, dernier message, non-lus, date.
  fastify.get("/api/v1/chat/conversations", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const convs = await prisma.conversation.findMany({
      where: { OR: [{ userAId: me }, { userBId: me }] },
      orderBy: { lastMessageAt: "desc" },
    });
    if (convs.length === 0) return reply.send([]);

    const otherIds = convs.map((c) => otherOf(c, me));
    const [users, reads, lastMsgs] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: otherIds } }, select: { id: true, username: true } }),
      prisma.conversationRead.findMany({ where: { userId: me, conversationId: { in: convs.map((c) => c.id) } } }),
      prisma.chatMessage.findMany({
        where: { conversationId: { in: convs.map((c) => c.id) } },
        orderBy: { createdAt: "desc" },
        distinct: ["conversationId"],
        select: { conversationId: true, body: true, fileName: true, createdAt: true, senderId: true, deletedAt: true },
      }),
    ]);
    const nameById = new Map(users.map((u) => [u.id, u.username]));
    const readAt = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));
    const lastByConv = new Map(lastMsgs.map((m) => [m.conversationId, m]));

    // Non-lus : messages reçus après la dernière lecture (comptés par requête groupée).
    const unreadRows = await prisma.chatMessage.groupBy({
      by: ["conversationId"],
      where: {
        conversationId: { in: convs.map((c) => c.id) },
        senderId: { not: me },
        deletedAt: null,
        OR: convs.map((c) => ({ conversationId: c.id, createdAt: { gt: readAt.get(c.id) ?? new Date(0) } })),
      },
      _count: { _all: true },
    });
    const unreadByConv = new Map(unreadRows.map((r) => [r.conversationId, r._count._all]));

    return reply.send(
      convs.map((c) => {
        const last = lastByConv.get(c.id);
        return {
          id: c.id,
          other_id: otherOf(c, me),
          other_name: nameById.get(otherOf(c, me)) ?? "—",
          last_message: last ? (last.deletedAt ? "" : last.fileName && !last.body ? "📎" : last.body) : "",
          last_at: c.lastMessageAt,
          unread: unreadByConv.get(c.id) ?? 0,
        };
      }),
    );
  });

  // Total de messages non lus (badge).
  fastify.get("/api/v1/chat/unread", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const convs = await prisma.conversation.findMany({ where: { OR: [{ userAId: me }, { userBId: me }] }, select: { id: true } });
    if (convs.length === 0) return reply.send({ unread: 0 });
    const reads = await prisma.conversationRead.findMany({ where: { userId: me, conversationId: { in: convs.map((c) => c.id) } } });
    const readAt = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));
    const count = await prisma.chatMessage.count({
      where: {
        senderId: { not: me },
        deletedAt: null,
        OR: convs.map((c) => ({ conversationId: c.id, createdAt: { gt: readAt.get(c.id) ?? new Date(0) } })),
      },
    });
    return reply.send({ unread: count });
  });

  // Démarrer / retrouver une conversation avec un collègue.
  fastify.post("/api/v1/chat/conversations", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const parsed = z.object({ user_id: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Destinataire invalide." });
    if (parsed.data.user_id === me) return reply.code(400).send({ code: "validation_error", message: "Vous ne pouvez pas discuter avec vous-même." });
    const other = await prisma.user.findFirst({ where: { id: parsed.data.user_id, status: "active", deletedAt: null }, select: { id: true, username: true } });
    if (!other) return reply.code(404).send({ code: "not_found", message: "Destinataire introuvable." });
    const conv = await getOrCreateConversation(me, other.id);
    return reply.code(201).send({ id: conv.id, other_id: other.id, other_name: other.username });
  });

  // Fil d'une conversation (participant, ou Direction avec traçage).
  fastify.get("/api/v1/chat/conversations/:id/messages", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });

    const participant = isParticipant(conv, me);
    const oversight = request.user!.permissions.has("direction:consultation");
    if (!participant && !oversight) {
      void writeAuditLog({ userId: me, action: "access_denied", entityType: "conversation", entityId: id, newValues: { url: request.url }, ipAddress: request.ip }).catch(() => {});
      return reply.code(403).send({ code: "forbidden", message: "Conversation privée : accès réservé aux participants." });
    }
    // Consultation par la Direction d'une conversation dont elle n'est pas membre : tracée.
    if (!participant && oversight) {
      await writeAuditLog({ userId: me, action: "view_sensitive", entityType: "conversation_supervision", entityId: id, newValues: { participants: [conv.userAId, conv.userBId] }, ipAddress: request.ip });
    }

    const msgs = await prisma.chatMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 500 });
    const senderIds = [...new Set(msgs.map((m) => m.senderId))];
    const senders = await prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, username: true } });
    const nameById = new Map(senders.map((s) => [s.id, s.username]));
    return reply.send(msgs.map((m) => messageView(m, nameById.get(m.senderId) ?? "—", me)));
  });

  // Envoi d'un message (texte et/ou pièce jointe). JSON pour le texte seul ;
  // multipart pour joindre un fichier.
  fastify.post("/api/v1/chat/conversations/:id/messages", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    if (!isParticipant(conv, me)) return reply.code(403).send({ code: "forbidden", message: "Conversation privée : accès réservé aux participants." });

    let body = "";
    let fileName: string | null = null;
    let filePath: string | null = null;
    let fileMime: string | null = null;
    let fileSize: number | null = null;

    if (request.isMultipart()) {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer();
          if (buf.byteLength > 0) {
            const stored = await storeFile(buf, part.filename || "piece-jointe");
            fileName = part.filename || "piece-jointe";
            filePath = stored.filePath;
            fileMime = part.mimetype || "application/octet-stream";
            fileSize = stored.fileSize;
          }
        } else if (part.fieldname === "body" && typeof part.value === "string") {
          body = part.value;
        }
      }
    } else {
      const parsed = z.object({ body: z.string().max(MAX_BODY) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Message invalide." });
      body = parsed.data.body;
    }

    body = body.trim().slice(0, MAX_BODY);
    if (!body && !filePath) return reply.code(400).send({ code: "validation_error", message: "Message vide : saisissez un texte ou joignez un fichier." });

    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({ data: { conversationId: id, senderId: me, body, fileName, filePath, fileMime, fileSize } });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: msg.createdAt } });
      // L'expéditeur a « lu » jusqu'à son propre message.
      await tx.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId: me } }, create: { conversationId: id, userId: me, lastReadAt: msg.createdAt }, update: { lastReadAt: msg.createdAt } });
      return msg;
    });

    const view = messageView(created, request.user!.username, me);
    // Livraison temps réel au correspondant connecté (le badge non-lus prend le
    // relais s'il est hors ligne).
    emitToUsers([otherOf(conv, me)], "chat:message", view);
    return reply.code(201).send(view);
  });

  // Marquer une conversation comme lue.
  fastify.post("/api/v1/chat/conversations/:id/read", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || !isParticipant(conv, me)) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    await prisma.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId: me } }, create: { conversationId: id, userId: me }, update: { lastReadAt: new Date() } });
    return reply.send({ ok: true });
  });

  // Suppression logique de son propre message.
  fastify.delete("/api/v1/chat/messages/:id", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const msg = await prisma.chatMessage.findUnique({ where: { id } });
    if (!msg || msg.deletedAt) return reply.code(404).send({ code: "not_found", message: "Message introuvable." });
    if (msg.senderId !== me) return reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez supprimer que vos propres messages." });
    await prisma.chatMessage.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: me } });
    return reply.send({ ok: true });
  });

  // Téléchargement d'une pièce jointe (participant ou Direction avec traçage).
  fastify.get("/api/v1/chat/messages/:id/file", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const msg = await prisma.chatMessage.findUnique({ where: { id }, include: { conversation: true } });
    if (!msg || msg.deletedAt || !msg.filePath) return reply.code(404).send({ code: "not_found", message: "Pièce jointe introuvable." });
    const participant = isParticipant(msg.conversation, me);
    const oversight = request.user!.permissions.has("direction:consultation");
    if (!participant && !oversight) return reply.code(403).send({ code: "forbidden", message: "Pièce jointe privée." });
    if (!participant && oversight) {
      await writeAuditLog({ userId: me, action: "view_sensitive", entityType: "conversation_supervision", entityId: msg.conversationId, newValues: { file: msg.fileName }, ipAddress: request.ip });
    }
    const buffer = await readStoredFile(msg.filePath);
    reply.header("content-type", msg.fileMime ?? "application/octet-stream");
    reply.header("content-disposition", `attachment; filename="${(msg.fileName ?? "piece-jointe").replace(/"/g, "")}"`);
    return reply.send(buffer);
  });
}
