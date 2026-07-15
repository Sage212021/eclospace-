import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { CalendarEventType, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Centre de Communication Interne — Calendrier partagé & événements
// (module « communication »). Événements de la maison, ciblés comme les
// annonces (tous / département / rôle / utilisateur). Un utilisateur ne voit
// que les événements qui le concernent (résolu côté serveur).

const targetSchema = z
  .object({ type: z.enum(["tous", "departement", "role", "utilisateur"]), id: z.string().uuid().optional() })
  .refine((t) => t.type === "tous" || Boolean(t.id), { message: "Identifiant de cible requis (sauf « tous »)." });

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  type: z.nativeEnum(CalendarEventType).default("autre"),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional(),
  all_day: z.boolean().default(false),
  location: z.string().trim().max(200).optional(),
  targets: z.array(targetSchema).min(1),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  type: z.nativeEnum(CalendarEventType).optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  all_day: z.boolean().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  targets: z.array(targetSchema).min(1).optional(),
});

const rangeQuery = z.object({ from: z.string().datetime(), to: z.string().datetime() });

function badRequest(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: issues });
}

function canManageAll(request: FastifyRequest): boolean {
  return request.user!.permissions.has("communication:administration");
}

// Portée de l'utilisateur pour la visibilité : son département et ses rôles.
async function viewerScope(userId: string): Promise<{ departmentId: string | null; roleIds: string[] }> {
  const [user, roles] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { employee: { select: { departmentId: true } } } }),
    prisma.userRole.findMany({ where: { userId, revokedAt: null }, select: { roleId: true } }),
  ]);
  return { departmentId: user?.employee?.departmentId ?? null, roleIds: roles.map((r) => r.roleId) };
}

function eventView(e: {
  id: string;
  title: string;
  description: string | null;
  type: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
  author: { id: string; username: string } | null;
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    type: e.type,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    all_day: e.allDay,
    location: e.location,
    author: e.author ? { id: e.author.id, username: e.author.username } : null,
  };
}

export default async function calendarRoutes(fastify: FastifyInstance) {
  // ── Liste des événements d'une plage (vue mensuelle) qui me concernent ─────
  fastify.get("/api/v1/calendar/events", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);

    let visibility: Prisma.CalendarEventWhereInput = {};
    if (!canManageAll(request)) {
      const scope = await viewerScope(request.user!.id);
      visibility = {
        targets: {
          some: {
            OR: [
              { targetType: "tous" },
              ...(scope.departmentId ? [{ targetType: "departement" as const, targetId: scope.departmentId }] : []),
              ...(scope.roleIds.length ? [{ targetType: "role" as const, targetId: { in: scope.roleIds } }] : []),
              { targetType: "utilisateur" as const, targetId: request.user!.id },
            ],
          },
        },
      };
    }

    const events = await prisma.calendarEvent.findMany({
      where: { deletedAt: null, startsAt: { gte: from, lt: to }, ...visibility },
      orderBy: { startsAt: "asc" },
      include: { author: { select: { id: true, username: true } } },
    });

    const managerAll = canManageAll(request);
    return reply.send(
      events.map((e) => ({ ...eventView(e), can_manage: managerAll || e.authorId === request.user!.id })),
    );
  });

  // ── Détail d'un événement ──────────────────────────────────────────────────
  fastify.get("/api/v1/calendar/events/:id", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await prisma.calendarEvent.findUnique({
      where: { id },
      include: { author: { select: { id: true, username: true } }, targets: true },
    });
    if (!event || event.deletedAt) return reply.code(404).send({ code: "not_found", message: "Événement introuvable." });

    const manage = canManageAll(request) || event.authorId === request.user!.id;
    if (!manage) {
      // Visible seulement si l'utilisateur est dans l'audience.
      const scope = await viewerScope(request.user!.id);
      const visible = event.targets.some(
        (tg) =>
          tg.targetType === "tous" ||
          (tg.targetType === "departement" && tg.targetId === scope.departmentId) ||
          (tg.targetType === "role" && tg.targetId != null && scope.roleIds.includes(tg.targetId)) ||
          (tg.targetType === "utilisateur" && tg.targetId === request.user!.id),
      );
      if (!visible) return reply.code(404).send({ code: "not_found", message: "Événement introuvable." });
    }

    return reply.send({
      ...eventView(event),
      can_manage: manage,
      targets: manage ? event.targets.map((tg) => ({ type: tg.targetType, id: tg.targetId })) : undefined,
    });
  });

  // ── Création ───────────────────────────────────────────────────────────────
  fastify.post("/api/v1/calendar/events", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const d = parsed.data;
    if (d.ends_at && new Date(d.ends_at) < new Date(d.starts_at)) {
      return reply.code(400).send({ code: "invalid_range", message: "La fin doit être postérieure au début." });
    }

    const created = await prisma.calendarEvent.create({
      data: {
        title: d.title,
        description: d.description || null,
        type: d.type,
        startsAt: new Date(d.starts_at),
        endsAt: d.ends_at ? new Date(d.ends_at) : null,
        allDay: d.all_day,
        location: d.location || null,
        authorId: request.user!.id,
        createdBy: request.user!.id,
        targets: { create: d.targets.map((t) => ({ targetType: t.type, targetId: t.type === "tous" ? null : t.id! })) },
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "calendar_event",
      entityId: created.id,
      newValues: { title: created.title, type: created.type, startsAt: created.startsAt },
      ipAddress: request.ip,
    });

    return reply.code(201).send({ id: created.id });
  });

  async function loadManageable(request: FastifyRequest, reply: FastifyReply, id: string) {
    const event = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!event || event.deletedAt) {
      reply.code(404).send({ code: "not_found", message: "Événement introuvable." });
      return null;
    }
    if (!canManageAll(request) && event.authorId !== request.user!.id) {
      reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez gérer que vos propres événements." });
      return null;
    }
    return event;
  }

  // ── Modification ───────────────────────────────────────────────────────────
  fastify.patch("/api/v1/calendar/events/:id", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const d = parsed.data;
    const event = await loadManageable(request, reply, id);
    if (!event) return;

    const patch: Prisma.CalendarEventUpdateInput = { updatedBy: request.user!.id };
    if (d.title !== undefined) patch.title = d.title;
    if (d.description !== undefined) patch.description = d.description;
    if (d.type !== undefined) patch.type = d.type;
    if (d.starts_at !== undefined) patch.startsAt = new Date(d.starts_at);
    if (d.ends_at !== undefined) patch.endsAt = d.ends_at ? new Date(d.ends_at) : null;
    if (d.all_day !== undefined) patch.allDay = d.all_day;
    if (d.location !== undefined) patch.location = d.location;

    await prisma.$transaction(async (tx) => {
      await tx.calendarEvent.update({ where: { id }, data: patch });
      if (d.targets !== undefined) {
        await tx.calendarEventTarget.deleteMany({ where: { eventId: id } });
        await tx.calendarEventTarget.createMany({
          data: d.targets.map((t) => ({ eventId: id, targetType: t.type, targetId: t.type === "tous" ? null : t.id! })),
        });
      }
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "calendar_event",
      entityId: id,
      newValues: { fields: Object.keys(patch).filter((k) => k !== "updatedBy") },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // ── Suppression logique ────────────────────────────────────────────────────
  fastify.delete("/api/v1/calendar/events/:id", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await loadManageable(request, reply, id);
    if (!event) return;
    await prisma.calendarEvent.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "status_change",
      entityType: "calendar_event",
      entityId: id,
      newValues: { deleted: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });
}
