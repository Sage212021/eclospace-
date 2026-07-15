import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AnnouncementPriority, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { sanitizeAnnouncementHtml, announcementPreview } from "../lib/announcementHtml.js";
import { publishAnnouncement, remindUnread, sweepExpiredAnnouncements } from "../lib/announcements.js";

// Centre de Communication Interne — Babillard d'annonces (module « communication »).
// Diffusion d'annonces officielles ciblées, suivi de lecture, journalisation.
// Réutilise la cloche de notifications (modèle Notification) et le journal
// d'audit inviolable. N'altère aucune donnée existante.

const targetSchema = z
  .object({
    type: z.enum(["tous", "departement", "role", "utilisateur"]),
    id: z.string().uuid().optional(),
  })
  .refine((t) => t.type === "tous" || Boolean(t.id), {
    message: "Un identifiant de cible est requis (sauf pour « tous »).",
  });

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body_html: z.string().min(1),
  category_code: z.string().trim().optional(),
  priority: z.nativeEnum(AnnouncementPriority).default("normale"),
  require_ack: z.boolean().default(false),
  pinned: z.boolean().default(false),
  expires_at: z.string().datetime().optional(),
  targets: z.array(targetSchema).min(1),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body_html: z.string().min(1).optional(),
  category_code: z.string().trim().nullable().optional(),
  priority: z.nativeEnum(AnnouncementPriority).optional(),
  require_ack: z.boolean().optional(),
  pinned: z.boolean().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  targets: z.array(targetSchema).min(1).optional(),
});

const prefsSchema = z.object({
  sound_enabled: z.boolean().optional(),
  sound_volume: z.number().int().min(0).max(100).optional(),
  visual_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  categories: z.array(z.string()).nullable().optional(),
});

function badRequest(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: issues });
}

function canManageAll(request: FastifyRequest): boolean {
  return request.user!.permissions.has("communication:administration");
}

// Vue « annonce » renvoyée au client (jamais l'objet Prisma brut).
function announcementView(a: {
  id: string;
  title: string;
  bodyHtml: string;
  priority: string;
  status: string;
  requireAck: boolean;
  pinned: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  category: { code: string; label: string } | null;
  author: { id: string; username: string } | null;
}) {
  return {
    id: a.id,
    title: a.title,
    body_html: a.bodyHtml,
    priority: a.priority,
    status: a.status,
    require_ack: a.requireAck,
    pinned: a.pinned,
    published_at: a.publishedAt,
    expires_at: a.expiresAt,
    created_at: a.createdAt,
    category: a.category ? { code: a.category.code, label: a.category.label } : null,
    author: a.author ? { id: a.author.id, username: a.author.username } : null,
  };
}

export default async function announcementRoutes(fastify: FastifyInstance) {
  // ── Catégories (référentiel, pour les formulaires et filtres) ──────────────
  fastify.get("/api/v1/announcement-categories", { preHandler: requireAuth }, async (_request, reply) => {
    const categories = await prisma.announcementCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { code: true, label: true },
    });
    return reply.send(categories);
  });

  // ── Options de ciblage (départements, rôles, utilisateurs) ─────────────────
  // Fourni par le module lui-même et réservé aux publieurs (communication:saisie),
  // pour ne pas exiger la permission users:consultation.
  fastify.get(
    "/api/v1/announcement-targets/options",
    { preHandler: requirePermission("communication", "saisie") },
    async (_request, reply) => {
      const [departments, roles, users] = await Promise.all([
        prisma.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.role.findMany({ orderBy: { label: "asc" }, select: { id: true, label: true } }),
        prisma.user.findMany({
          where: { status: "active", deletedAt: null },
          orderBy: { username: "asc" },
          select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } },
        }),
      ]);
      return reply.send({
        departments,
        roles,
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.username,
        })),
      });
    },
  );

  // ── Fil personnel : les annonces publiées qui me ciblent ───────────────────
  const feedQuery = z.object({
    unread: z.enum(["true", "false"]).optional(),
    category: z.string().optional(),
    priority: z.nativeEnum(AnnouncementPriority).optional(),
    status: z.enum(["publiee", "archivee"]).optional(),
  });
  fastify.get(
    "/api/v1/announcements",
    { preHandler: requirePermission("communication", "consultation") },
    async (request, reply) => {
      const parsed = feedQuery.safeParse(request.query);
      if (!parsed.success) return badRequest(reply, parsed.error.issues);
      const { unread, category, priority, status } = parsed.data;
      await sweepExpiredAnnouncements().catch(() => {});

      const receipts = await prisma.announcementReceipt.findMany({
        where: {
          userId: request.user!.id,
          ...(unread === "true" ? { readAt: null } : {}),
          ...(unread === "false" ? { readAt: { not: null } } : {}),
          announcement: {
            deletedAt: null,
            status: status ?? "publiee",
            ...(priority ? { priority } : {}),
            ...(category ? { category: { code: category } } : {}),
          },
        },
        include: {
          announcement: { include: { category: true, author: { select: { id: true, username: true } } } },
        },
      });

      // Tri : épinglées d'abord, puis par date de publication décroissante.
      receipts.sort((a, b) => {
        const ap = a.announcement.pinned ? 1 : 0;
        const bp = b.announcement.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return (b.announcement.publishedAt?.getTime() ?? 0) - (a.announcement.publishedAt?.getTime() ?? 0);
      });

      return reply.send(
        receipts.map((r) => ({
          ...announcementView(r.announcement),
          preview: announcementPreview(r.announcement.bodyHtml),
          read_at: r.readAt,
          acknowledged_at: r.acknowledgedAt,
        })),
      );
    },
  );

  // ── Bannière : annonces Urgentes/Critiques actives qui me ciblent ──────────
  // Alimente le bandeau défilant en tête du tableau de bord (visible dès la
  // connexion). Balaie d'abord les annonces expirées (archivage automatique).
  fastify.get(
    "/api/v1/announcements/banner",
    { preHandler: requirePermission("communication", "consultation") },
    async (request, reply) => {
      await sweepExpiredAnnouncements().catch(() => {});
      const receipts = await prisma.announcementReceipt.findMany({
        where: {
          userId: request.user!.id,
          announcement: {
            deletedAt: null,
            status: "publiee",
            priority: { in: ["urgente", "critique"] },
          },
        },
        include: { announcement: { select: { id: true, title: true, bodyHtml: true, priority: true, pinned: true, publishedAt: true } } },
      });
      receipts.sort((a, b) => (b.announcement.publishedAt?.getTime() ?? 0) - (a.announcement.publishedAt?.getTime() ?? 0));
      return reply.send(
        receipts.map((r) => ({
          id: r.announcement.id,
          title: r.announcement.title,
          priority: r.announcement.priority,
          preview: announcementPreview(r.announcement.bodyHtml, 120),
          acknowledged: Boolean(r.acknowledgedAt),
        })),
      );
    },
  );

  // ── Nombre de non-lues (pour le badge de la cloche, complément à /notifications) ──
  fastify.get(
    "/api/v1/announcements/unread-count",
    { preHandler: requirePermission("communication", "consultation") },
    async (request, reply) => {
      const count = await prisma.announcementReceipt.count({
        where: { userId: request.user!.id, readAt: null, announcement: { deletedAt: null, status: "publiee" } },
      });
      return reply.send({ count });
    },
  );

  // ── Vue de gestion : toutes mes annonces (ou toutes, si administration) ─────
  fastify.get(
    "/api/v1/announcements/manage",
    { preHandler: requirePermission("communication", "saisie") },
    async (request, reply) => {
      await sweepExpiredAnnouncements().catch(() => {});
      const rows = await prisma.announcement.findMany({
        where: {
          deletedAt: null,
          ...(canManageAll(request) ? {} : { authorId: request.user!.id }),
        },
        orderBy: [{ createdAt: "desc" }],
        include: {
          category: true,
          author: { select: { id: true, username: true } },
          _count: { select: { receipts: true } },
        },
      });

      // Nombre de lectures par annonce (pour un aperçu du suivi).
      const readCounts = await prisma.announcementReceipt.groupBy({
        by: ["announcementId"],
        where: { announcementId: { in: rows.map((r) => r.id) }, readAt: { not: null } },
        _count: { _all: true },
      });
      const readByAnn = new Map(readCounts.map((c) => [c.announcementId, c._count._all]));

      return reply.send(
        rows.map((a) => ({
          ...announcementView(a),
          recipients: a._count.receipts,
          read: readByAnn.get(a.id) ?? 0,
        })),
      );
    },
  );

  // ── Détail d'une annonce ───────────────────────────────────────────────────
  fastify.get("/api/v1/announcements/:id", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ann = await prisma.announcement.findUnique({
      where: { id },
      include: {
        category: true,
        author: { select: { id: true, username: true } },
        targets: true,
      },
    });
    if (!ann || ann.deletedAt) return reply.code(404).send({ code: "not_found", message: "Annonce introuvable." });

    const receipt = await prisma.announcementReceipt.findUnique({
      where: { announcementId_userId: { announcementId: id, userId: request.user!.id } },
    });
    const manage = canManageAll(request) || ann.authorId === request.user!.id;
    if (!receipt && !manage) {
      // L'annonce ne me cible pas et je ne la gère pas : introuvable pour moi.
      return reply.code(404).send({ code: "not_found", message: "Annonce introuvable." });
    }

    // Consultation d'un destinataire ciblé : marque lu + trace au journal.
    if (receipt && !receipt.readAt) {
      await prisma.announcementReceipt.update({ where: { id: receipt.id }, data: { readAt: new Date() } });
    }
    await writeAuditLog({
      userId: request.user!.id,
      action: "view_sensitive",
      entityType: "announcement",
      entityId: id,
      ipAddress: request.ip,
    });

    return reply.send({
      ...announcementView(ann),
      read_at: receipt?.readAt ?? new Date(),
      acknowledged_at: receipt?.acknowledgedAt ?? null,
      require_ack: ann.requireAck,
      targets: manage ? ann.targets.map((t) => ({ type: t.targetType, id: t.targetId })) : undefined,
    });
  });

  // ── Création d'un brouillon ────────────────────────────────────────────────
  fastify.post("/api/v1/announcements", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const data = parsed.data;

    let categoryId: string | null = null;
    if (data.category_code) {
      const cat = await prisma.announcementCategory.findUnique({ where: { code: data.category_code } });
      if (!cat) return reply.code(400).send({ code: "invalid_category", message: `Catégorie inconnue : ${data.category_code}.` });
      categoryId = cat.id;
    }

    const bodyHtml = sanitizeAnnouncementHtml(data.body_html);
    if (!bodyHtml) return reply.code(400).send({ code: "empty_body", message: "Le contenu est vide après nettoyage." });

    const created = await prisma.announcement.create({
      data: {
        title: data.title,
        bodyHtml,
        categoryId,
        priority: data.priority,
        requireAck: data.require_ack,
        pinned: data.pinned,
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
        authorId: request.user!.id,
        createdBy: request.user!.id,
        targets: { create: data.targets.map((t) => ({ targetType: t.type, targetId: t.type === "tous" ? null : t.id! })) },
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "announcement",
      entityId: created.id,
      newValues: { title: created.title, priority: created.priority, status: created.status },
      ipAddress: request.ip,
    });

    return reply.code(201).send({ id: created.id });
  });

  // Charge une annonce et vérifie que l'appelant peut la gérer (auteur ou admin).
  async function loadManageable(request: FastifyRequest, reply: FastifyReply, id: string) {
    const ann = await prisma.announcement.findUnique({ where: { id }, include: { targets: true } });
    if (!ann || ann.deletedAt) {
      reply.code(404).send({ code: "not_found", message: "Annonce introuvable." });
      return null;
    }
    if (!canManageAll(request) && ann.authorId !== request.user!.id) {
      reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez gérer que vos propres annonces." });
      return null;
    }
    return ann;
  }

  // ── Édition ────────────────────────────────────────────────────────────────
  fastify.patch("/api/v1/announcements/:id", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const data = parsed.data;

    const ann = await loadManageable(request, reply, id);
    if (!ann) return;
    if (ann.status === "archivee") {
      return reply.code(409).send({ code: "archived", message: "Une annonce archivée ne peut plus être modifiée." });
    }

    const patch: Record<string, unknown> = { updatedBy: request.user!.id };
    if (data.title !== undefined) patch.title = data.title;
    if (data.body_html !== undefined) {
      const clean = sanitizeAnnouncementHtml(data.body_html);
      if (!clean) return reply.code(400).send({ code: "empty_body", message: "Le contenu est vide après nettoyage." });
      patch.bodyHtml = clean;
    }
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.require_ack !== undefined) patch.requireAck = data.require_ack;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    if (data.expires_at !== undefined) patch.expiresAt = data.expires_at ? new Date(data.expires_at) : null;
    if (data.category_code !== undefined) {
      if (data.category_code === null) {
        patch.categoryId = null;
      } else {
        const cat = await prisma.announcementCategory.findUnique({ where: { code: data.category_code } });
        if (!cat) return reply.code(400).send({ code: "invalid_category", message: `Catégorie inconnue : ${data.category_code}.` });
        patch.categoryId = cat.id;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.announcement.update({ where: { id }, data: patch });
      if (data.targets !== undefined) {
        await tx.announcementTarget.deleteMany({ where: { announcementId: id } });
        await tx.announcementTarget.createMany({
          data: data.targets.map((t) => ({ announcementId: id, targetType: t.type, targetId: t.type === "tous" ? null : t.id! })),
        });
      }
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "announcement",
      entityId: id,
      newValues: { fields: Object.keys(patch).filter((k) => k !== "updatedBy") },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });

  // ── Publication ────────────────────────────────────────────────────────────
  fastify.post("/api/v1/announcements/:id/publish", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ann = await loadManageable(request, reply, id);
    if (!ann) return;
    if (ann.status === "archivee") {
      return reply.code(409).send({ code: "archived", message: "Une annonce archivée ne peut être republiée." });
    }
    const result = await publishAnnouncement(id, { id: request.user!.id, ip: request.ip });
    return reply.send({ ok: true, recipients: result.recipients });
  });

  // ── Archivage ──────────────────────────────────────────────────────────────
  fastify.post("/api/v1/announcements/:id/archive", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ann = await loadManageable(request, reply, id);
    if (!ann) return;
    await prisma.announcement.update({ where: { id }, data: { status: "archivee", updatedBy: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "status_change",
      entityType: "announcement",
      entityId: id,
      newValues: { status: "archivee" },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // ── Suppression logique ────────────────────────────────────────────────────
  fastify.delete("/api/v1/announcements/:id", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ann = await loadManageable(request, reply, id);
    if (!ann) return;
    await prisma.announcement.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "status_change",
      entityType: "announcement",
      entityId: id,
      newValues: { deleted: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // ── Suivi de lecture (auteur ou administration) ────────────────────────────
  fastify.get("/api/v1/announcements/:id/receipts", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ann = await loadManageable(request, reply, id);
    if (!ann) return;
    const receipts = await prisma.announcementReceipt.findMany({
      where: { announcementId: id },
      include: { user: { select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } } } },
      orderBy: [{ readAt: "asc" }],
    });
    const rows = receipts.map((r) => ({
      user_id: r.userId,
      username: r.user.username,
      name: r.user.employee ? `${r.user.employee.firstName} ${r.user.employee.lastName}` : r.user.username,
      read_at: r.readAt,
      acknowledged_at: r.acknowledgedAt,
    }));
    return reply.send({
      total: rows.length,
      read: rows.filter((r) => r.read_at).length,
      acknowledged: rows.filter((r) => r.acknowledged_at).length,
      require_ack: ann.requireAck,
      rows,
    });
  });

  // ── Relance de lecture (auteur ou administration) ──────────────────────────
  fastify.post("/api/v1/announcements/:id/remind", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ann = await loadManageable(request, reply, id);
    if (!ann) return;
    if (ann.status !== "publiee") {
      return reply.code(409).send({ code: "not_published", message: "Seule une annonce publiée peut faire l'objet d'une relance." });
    }
    const result = await remindUnread(id, { id: request.user!.id, ip: request.ip });
    return reply.send({ ok: true, reminded: result.reminded });
  });

  // ── Marquer lu / accuser réception (destinataire) ──────────────────────────
  async function ownReceipt(request: FastifyRequest, reply: FastifyReply, id: string) {
    const receipt = await prisma.announcementReceipt.findUnique({
      where: { announcementId_userId: { announcementId: id, userId: request.user!.id } },
    });
    if (!receipt) {
      reply.code(404).send({ code: "not_found", message: "Annonce introuvable." });
      return null;
    }
    return receipt;
  }

  fastify.post("/api/v1/announcements/:id/read", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await ownReceipt(request, reply, id);
    if (!receipt) return;
    if (!receipt.readAt) await prisma.announcementReceipt.update({ where: { id: receipt.id }, data: { readAt: new Date() } });
    return reply.send({ ok: true });
  });

  fastify.post("/api/v1/announcements/:id/ack", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await ownReceipt(request, reply, id);
    if (!receipt) return;
    const now = new Date();
    await prisma.announcementReceipt.update({
      where: { id: receipt.id },
      data: { readAt: receipt.readAt ?? now, acknowledgedAt: receipt.acknowledgedAt ?? now },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "validate",
      entityType: "announcement_receipt",
      entityId: id,
      newValues: { acknowledged: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // ── Préférences de notification (par utilisateur) ──────────────────────────
  fastify.get("/api/v1/me/notification-preferences", { preHandler: requireAuth }, async (request, reply) => {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: request.user!.id } });
    return reply.send({
      sound_enabled: prefs?.soundEnabled ?? true,
      sound_volume: prefs?.soundVolume ?? 70,
      visual_enabled: prefs?.visualEnabled ?? true,
      email_enabled: prefs?.emailEnabled ?? true,
      categories: (prefs?.categories as string[] | null) ?? null,
    });
  });

  fastify.put("/api/v1/me/notification-preferences", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = prefsSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const d = parsed.data;
    const data = {
      ...(d.sound_enabled !== undefined ? { soundEnabled: d.sound_enabled } : {}),
      ...(d.sound_volume !== undefined ? { soundVolume: d.sound_volume } : {}),
      ...(d.visual_enabled !== undefined ? { visualEnabled: d.visual_enabled } : {}),
      ...(d.email_enabled !== undefined ? { emailEnabled: d.email_enabled } : {}),
      // categories = null signifie « toutes les catégories » (on stocke NULL) ;
      // un tableau restreint aux catégories choisies.
      ...(d.categories !== undefined ? { categories: d.categories === null ? Prisma.JsonNull : d.categories } : {}),
    };
    await prisma.notificationPreference.upsert({
      where: { userId: request.user!.id },
      update: data,
      create: { userId: request.user!.id, ...data },
    });
    return reply.send({ ok: true });
  });
}
