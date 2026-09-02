import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { emitToUsers } from "../lib/realtime.js";
import { isUserActive } from "../lib/presence.js";
import { sendWebPushToUsers } from "../lib/pushWeb.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import { getOrCreateConversation, otherOf, isParticipant } from "../lib/chat.js";

// Messagerie interne 1-à-1 (demande opérateur du 25/07/2026). Annuaire ouvert
// (chacun écrit à tout le monde), présence masquée hors pôle (règle existante,
// non touchée ici). Messages privés entre les deux participants ; la Direction
// générale (direction:consultation) peut consulter au besoin, chaque accès à une
// conversation dont elle n'est pas membre étant tracé au journal d'audit.

const MAX_BODY = 4000;

// Aperçu court d'un message cité (« Répondre ») : de qui, et un extrait.
interface ReplyPreview {
  id: string;
  sender_name: string;
  excerpt: string;
}

function replyExcerpt(m: { body: string; fileName: string | null; deletedAt: Date | null }): string {
  if (m.deletedAt) return "Message supprimé";
  if (m.body) return m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body;
  if (m.fileName) return `📎 ${m.fileName}`;
  return "";
}

function messageView(
  m: {
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
    fileName: string | null;
    fileMime: string | null;
    fileSize: number | null;
    createdAt: Date;
    deletedAt: Date | null;
    editedAt?: Date | null;
    forwarded?: boolean;
    replyToId?: string | null;
  },
  senderName: string,
  me: string,
  replyPreview?: ReplyPreview | null,
) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_id: m.senderId,
    sender_name: senderName,
    mine: m.senderId === me,
    body: m.deletedAt ? "" : m.body,
    deleted: Boolean(m.deletedAt),
    created_at: m.createdAt,
    edited: Boolean(m.editedAt) && !m.deletedAt,
    edited_at: m.deletedAt ? null : m.editedAt ?? null,
    forwarded: Boolean(m.forwarded) && !m.deletedAt,
    reply_to: m.deletedAt ? null : replyPreview ?? null,
    read: false, // accusé de lecture ; surchargé à la lecture du fil
    file: m.deletedAt || !m.fileName ? null : { name: m.fileName, mime: m.fileMime, size: m.fileSize },
  };
}

export default async function chatRoutes(fastify: FastifyInstance) {
  // Annuaire : tous les collègues actifs (hors soi), sans indicateur « en ligne ».
  fastify.get("/api/v1/chat/directory", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const users = await prisma.user.findMany({
      where: { status: "active", deletedAt: null, accountType: "internal", id: { not: me } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
    return reply.send(users.map((u) => ({ id: u.id, name: u.username })));
  });

  // Mes conversations : correspondant, dernier message, non-lus, date.
  fastify.get("/api/v1/chat/conversations", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const allConvs = await prisma.conversation.findMany({
      where: { OR: [{ userAId: me }, { userBId: me }] },
      orderBy: { lastMessageAt: "desc" },
    });
    if (allConvs.length === 0) return reply.send([]);

    // Marqueurs par utilisateur (lecture + « effacé de mon côté »).
    const myReads = await prisma.conversationRead.findMany({ where: { userId: me, conversationId: { in: allConvs.map((c) => c.id) } } });
    const clearedAt = new Map(myReads.map((r) => [r.conversationId, r.clearedAt]));
    // Une conversation effacée de mon côté reste masquée tant qu'aucun message
    // plus récent que l'effacement n'est arrivé.
    const convs = allConvs.filter((c) => {
      const cl = clearedAt.get(c.id);
      if (!cl) return true;
      return c.lastMessageAt != null && c.lastMessageAt > cl;
    });
    if (convs.length === 0) return reply.send([]);

    const otherIds = convs.map((c) => otherOf(c, me));
    const [users, reads, lastMsgs] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: otherIds } }, select: { id: true, username: true } }),
      Promise.resolve(myReads.filter((r) => convs.some((c) => c.id === r.conversationId))),
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

    // « Effacé de mon côté » : un participant ne voit que les messages postérieurs
    // à son effacement. La Direction en supervision voit tout l'historique.
    let clearedFilter: { createdAt: { gt: Date } } | Record<string, never> = {};
    if (participant) {
      const myRead = await prisma.conversationRead.findUnique({ where: { conversationId_userId: { conversationId: id, userId: me } } });
      if (myRead?.clearedAt) clearedFilter = { createdAt: { gt: myRead.clearedAt } };
    }
    const msgs = await prisma.chatMessage.findMany({ where: { conversationId: id, ...clearedFilter }, orderBy: { createdAt: "asc" }, take: 500 });
    const senderIds = [...new Set(msgs.map((m) => m.senderId))];
    const senders = await prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, username: true } });
    const nameById = new Map(senders.map((s) => [s.id, s.username]));
    // Aperçus des messages cités (« Répondre ») : résolus en un seul lot.
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const replyPreview = (replyToId: string | null): ReplyPreview | null => {
      if (!replyToId) return null;
      const src = byId.get(replyToId);
      if (!src) return null;
      return { id: src.id, sender_name: nameById.get(src.senderId) ?? "—", excerpt: replyExcerpt(src) };
    };
    // Accusé de lecture : un message que J'AI envoyé est « lu » si le correspondant
    // a consulté la conversation après son envoi (2 coches or côté client).
    const otherRead = await prisma.conversationRead.findUnique({ where: { conversationId_userId: { conversationId: id, userId: otherOf(conv, me) } } });
    const otherReadAt = otherRead?.lastReadAt ?? null;
    return reply.send(
      msgs.map((m) => ({
        ...messageView(m, nameById.get(m.senderId) ?? "—", me, replyPreview(m.replyToId)),
        read: m.senderId === me && !!otherReadAt && otherReadAt >= m.createdAt,
      })),
    );
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
    let replyToId: string | null = null;

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
        } else if (part.fieldname === "reply_to_id" && typeof part.value === "string" && part.value) {
          replyToId = part.value;
        }
      }
    } else {
      const parsed = z.object({ body: z.string().max(MAX_BODY), reply_to_id: z.string().uuid().optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Message invalide." });
      body = parsed.data.body;
      replyToId = parsed.data.reply_to_id ?? null;
    }

    body = body.trim().slice(0, MAX_BODY);
    if (!body && !filePath) return reply.code(400).send({ code: "validation_error", message: "Message vide : saisissez un texte ou joignez un fichier." });

    // Le message cité doit exister et appartenir à CE fil (« Répondre »).
    let replyPreview: ReplyPreview | null = null;
    if (replyToId) {
      const src = await prisma.chatMessage.findUnique({ where: { id: replyToId }, include: { sender: { select: { username: true } } } });
      if (!src || src.conversationId !== id) {
        return reply.code(400).send({ code: "validation_error", message: "Message cité introuvable dans cette conversation." });
      }
      replyPreview = { id: src.id, sender_name: src.sender.username, excerpt: replyExcerpt(src) };
    }

    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({ data: { conversationId: id, senderId: me, body, fileName, filePath, fileMime, fileSize, replyToId } });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: msg.createdAt } });
      // L'expéditeur a « lu » jusqu'à son propre message.
      await tx.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId: me } }, create: { conversationId: id, userId: me, lastReadAt: msg.createdAt }, update: { lastReadAt: msg.createdAt } });
      return msg;
    });

    const view = messageView(created, request.user!.username, me, replyPreview);
    const recipient = otherOf(conv, me);
    // Livraison temps réel au correspondant connecté (le badge non-lus prend le
    // relais s'il est hors ligne).
    emitToUsers([recipient], "chat:message", view);
    // Notification « push » sur le téléphone UNIQUEMENT si le destinataire n'est
    // pas déjà actif au premier plan (sinon la bulle temps réel suffit) : le
    // message arrive alors même écran rabattu ou application fermée. Au meilleur
    // effort — n'échoue jamais l'envoi du message. L'aperçu reste court.
    if (!isUserActive(recipient)) {
      const preview = body ? (body.length > 90 ? `${body.slice(0, 90)}…` : body) : "📎 Pièce jointe";
      void sendWebPushToUsers([recipient], {
        type: "autre",
        priority: "medium",
        title: `💬 ${request.user!.username}`,
        body: preview,
        entityType: "chat_conversation",
        entityId: id,
      }).catch(() => {});
    }
    return reply.code(201).send(view);
  });

  // Marquer une conversation comme lue.
  fastify.post("/api/v1/chat/conversations/:id/read", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || !isParticipant(conv, me)) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const readAt = new Date();
    await prisma.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId: me } }, create: { conversationId: id, userId: me, lastReadAt: readAt }, update: { lastReadAt: readAt } });
    // Prévient l'expéditeur en temps réel que ses messages sont lus (2 coches or).
    emitToUsers([otherOf(conv, me)], "chat:read", { conversationId: id, readerId: me, readAt });
    return reply.send({ ok: true });
  });

  // « Supprimer la discussion ». Deux portées (choix au moment de supprimer) :
  //  • scope=me  → efface la conversation de MON côté (marqueur clearedAt) ;
  //    l'autre garde sa copie ; elle réapparaît si un message plus récent arrive.
  //  • scope=all → supprime logiquement TOUS les messages (pour les deux) et
  //    efface la conversation des deux côtés. Rien n'est effacé physiquement
  //    (suppression logique + journal d'audit).
  fastify.delete("/api/v1/chat/conversations/:id", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const parsed = z.object({ scope: z.enum(["me", "all"]).default("me") }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Portée invalide." });
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || !isParticipant(conv, me)) return reply.code(404).send({ code: "not_found", message: "Conversation introuvable." });
    const now = new Date();
    const other = otherOf(conv, me);

    if (parsed.data.scope === "all") {
      await prisma.$transaction(async (tx) => {
        await tx.chatMessage.updateMany({ where: { conversationId: id, deletedAt: null }, data: { deletedAt: now, deletedBy: me } });
        for (const uid of [me, other]) {
          await tx.conversationRead.upsert({
            where: { conversationId_userId: { conversationId: id, userId: uid } },
            create: { conversationId: id, userId: uid, lastReadAt: now, clearedAt: now },
            update: { lastReadAt: now, clearedAt: now },
          });
        }
      });
      await writeAuditLog({ userId: me, action: "update", entityType: "conversation", entityId: id, newValues: { deleted: "all", participants: [conv.userAId, conv.userBId] }, ipAddress: request.ip });
      // Le correspondant retire la discussion de sa liste en temps réel.
      emitToUsers([other], "chat:conversation:cleared", { conversationId: id });
      return reply.send({ ok: true, scope: "all" });
    }

    // scope=me : effacement de mon seul côté (réversible si nouveau message).
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: id, userId: me } },
      create: { conversationId: id, userId: me, lastReadAt: now, clearedAt: now },
      update: { lastReadAt: now, clearedAt: now },
    });
    return reply.send({ ok: true, scope: "me" });
  });

  // Suppression logique de son propre message.
  fastify.delete("/api/v1/chat/messages/:id", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const msg = await prisma.chatMessage.findUnique({ where: { id } });
    if (!msg || msg.deletedAt) return reply.code(404).send({ code: "not_found", message: "Message introuvable." });
    if (msg.senderId !== me) return reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez supprimer que vos propres messages." });
    await prisma.chatMessage.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: me } });
    // Prévient le correspondant pour qu'il retire le message en temps réel.
    const conv = await prisma.conversation.findUnique({ where: { id: msg.conversationId } });
    if (conv) emitToUsers([otherOf(conv, me)], "chat:message:update", { ...messageView({ ...msg, deletedAt: new Date() }, "", me), read: false });
    return reply.send({ ok: true });
  });

  // Modification (« Modifier ») du texte de son propre message. La pièce jointe
  // n'est pas modifiée (immuable) ; seul le texte change, et l'édition est
  // signalée (horodatage « modifié »).
  fastify.patch("/api/v1/chat/messages/:id", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const parsed = z.object({ body: z.string().max(MAX_BODY) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Message invalide." });

    const msg = await prisma.chatMessage.findUnique({ where: { id } });
    if (!msg || msg.deletedAt) return reply.code(404).send({ code: "not_found", message: "Message introuvable." });
    if (msg.senderId !== me) return reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez modifier que vos propres messages." });

    const nextBody = parsed.data.body.trim().slice(0, MAX_BODY);
    if (!nextBody && !msg.filePath) return reply.code(400).send({ code: "validation_error", message: "Un message sans pièce jointe ne peut pas être vidé : supprimez-le plutôt." });

    const editedAt = new Date();
    const updated = await prisma.chatMessage.update({ where: { id }, data: { body: nextBody, editedAt } });

    // Aperçu du message cité éventuel, pour que la vue reste complète.
    let replyPreview: ReplyPreview | null = null;
    if (updated.replyToId) {
      const src = await prisma.chatMessage.findUnique({ where: { id: updated.replyToId }, include: { sender: { select: { username: true } } } });
      if (src) replyPreview = { id: src.id, sender_name: src.sender.username, excerpt: replyExcerpt(src) };
    }
    const view = messageView(updated, request.user!.username, me, replyPreview);
    const conv = await prisma.conversation.findUnique({ where: { id: updated.conversationId } });
    if (conv) emitToUsers([otherOf(conv, me)], "chat:message:update", { ...view, mine: false, read: false });
    return reply.send(view);
  });

  // Transfert (« Transférer ») d'un message vers un collègue : recopie le texte
  // et la pièce jointe éventuelle dans la conversation avec ce collègue (créée au
  // besoin). Le message transféré est marqué comme tel.
  fastify.post("/api/v1/chat/messages/:id/forward", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.user!.id;
    const { id } = request.params as { id: string };
    const parsed = z.object({ to_user_id: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Destinataire invalide." });
    if (parsed.data.to_user_id === me) return reply.code(400).send({ code: "validation_error", message: "Vous ne pouvez pas vous transférer un message à vous-même." });

    const src = await prisma.chatMessage.findUnique({ where: { id }, include: { conversation: true } });
    if (!src || src.deletedAt) return reply.code(404).send({ code: "not_found", message: "Message introuvable." });
    // Seul un participant du fil d'origine peut transférer (confidentialité).
    if (!isParticipant(src.conversation, me) && !request.user!.permissions.has("direction:consultation")) {
      return reply.code(403).send({ code: "forbidden", message: "Conversation privée : transfert réservé aux participants." });
    }
    const target = await prisma.user.findFirst({ where: { id: parsed.data.to_user_id, status: "active", deletedAt: null }, select: { id: true, username: true } });
    if (!target) return reply.code(404).send({ code: "not_found", message: "Destinataire introuvable." });

    const conv = await getOrCreateConversation(me, target.id);
    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          conversationId: conv.id,
          senderId: me,
          body: src.body,
          // La pièce jointe est immuable et adressée par empreinte : on réutilise
          // la même référence de stockage, sans recopier le fichier.
          fileName: src.fileName,
          filePath: src.filePath,
          fileMime: src.fileMime,
          fileSize: src.fileSize,
          forwarded: true,
        },
      });
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: msg.createdAt } });
      await tx.conversationRead.upsert({ where: { conversationId_userId: { conversationId: conv.id, userId: me } }, create: { conversationId: conv.id, userId: me, lastReadAt: msg.createdAt }, update: { lastReadAt: msg.createdAt } });
      return msg;
    });

    const view = messageView(created, request.user!.username, me);
    emitToUsers([target.id], "chat:message", { ...view, mine: false, read: false });
    // Push si le destinataire n'est pas actif au premier plan (message transféré).
    if (!isUserActive(target.id)) {
      const preview = src.body ? (src.body.length > 90 ? `${src.body.slice(0, 90)}…` : src.body) : "📎 Pièce jointe";
      void sendWebPushToUsers([target.id], {
        type: "autre",
        priority: "medium",
        title: `💬 ${request.user!.username}`,
        body: preview,
        entityType: "chat_conversation",
        entityId: conv.id,
      }).catch(() => {});
    }
    return reply.code(201).send({ ...view, conversation_id: conv.id, other_id: target.id, other_name: target.username });
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
