import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { CalendarEventType, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { resolveAudience } from "../lib/announcements.js";
import { notifyUsers } from "../lib/notify.js";
import { getHallAgendaConfig, setHallAgendaConfig } from "../lib/hallAgenda.js";

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

// Anniversaires des collaborateurs sur une plage : événements virtuels « journée
// entière ». On ne divulgue jamais l'année de naissance ni l'âge — seulement le
// jour et le mois. Exclut les dossiers supprimés et les départs déjà effectifs.
async function buildBirthdayEvents(from: Date, to: Date) {
  const employees = await prisma.employee.findMany({
    where: {
      deletedAt: null,
      birthDate: { not: null },
      OR: [{ departureDate: null }, { departureDate: { gt: new Date() } }],
    },
    select: { id: true, firstName: true, lastName: true, birthDate: true },
  });
  const years = new Set([from.getUTCFullYear(), to.getUTCFullYear()]);
  const out: {
    id: string;
    title: string;
    description: null;
    type: string;
    starts_at: string;
    ends_at: null;
    all_day: boolean;
    location: null;
    author: null;
    can_manage: boolean;
    birthday: boolean;
    person: string;
  }[] = [];
  for (const e of employees) {
    const bd = e.birthDate!;
    const m = bd.getUTCMonth();
    const d = bd.getUTCDate();
    const name = `${e.firstName} ${e.lastName}`;
    for (const y of years) {
      const date = new Date(Date.UTC(y, m, d, 0, 0, 0));
      if (date >= from && date < to) {
        out.push({
          id: `birthday:${e.id}:${y}`,
          title: `Anniversaire de ${name}`,
          description: null,
          type: "ceremonie",
          starts_at: date.toISOString(),
          ends_at: null,
          all_day: true,
          location: null,
          author: null,
          can_manage: false,
          birthday: true,
          person: name,
        });
      }
    }
  }
  return out;
}

// Format compact et neutre (indépendant de la langue) pour le corps des
// notifications d'événement.
// Choisit une icône pour un événement du « Planning des événements » (qui n'a
// pas de champ « type ») d'après ses mots-clés — réutilise les mêmes familles
// d'icônes que le bandeau (dédicace, salon, lancement, formation…).
function annualEventIcon(title: string, description?: string | null): string {
  const t = `${title} ${description ?? ""}`.toLocaleLowerCase("fr");
  if (/(dédicace|dedicace|dédica|dedica|signature)/.test(t)) return "dedicace";
  if (/(salon|foire)/.test(t)) return "salon";
  if (/(lancement)/.test(t)) return "lancement";
  if (/(masterclass|formation|atelier|académie|academie)/.test(t)) return "formation";
  if (/(voyage|mission|déplacement|deplacement)/.test(t)) return "sortie";
  return "ceremonie";
}

function eventWhen(startsAt: Date, allDay: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${startsAt.getUTCFullYear()}-${p(startsAt.getUTCMonth() + 1)}-${p(startsAt.getUTCDate())}`;
  return allDay ? day : `${day} ${p(startsAt.getUTCHours())}:${p(startsAt.getUTCMinutes())}`;
}

// Notifie l'audience d'un événement (cloche + e-mail selon la priorité). Les
// échéances passent en priorité « haute » (doublées d'un e-mail) ; les autres
// événements restent en priorité « moyenne » (cloche seule).
async function notifyEventAudience(
  event: { id: string; title: string; type: string; startsAt: Date; allDay: boolean; location: string | null },
  targets: { targetType: string; targetId: string | null }[],
  opts: { reminder?: boolean } = {},
): Promise<number> {
  const audience = await resolveAudience(targets);
  const userIds = [...audience];
  if (userIds.length === 0) return 0;
  const priority = event.type === "echeance" ? ("high" as const) : ("medium" as const);
  const prefix = opts.reminder ? "Rappel" : "Nouvel événement";
  const where = eventWhen(event.startsAt, event.allDay);
  await notifyUsers({
    userIds,
    type: "autre",
    priority,
    title: `${prefix} : ${event.title}`,
    body: `${where}${event.location ? ` · ${event.location}` : ""}`,
    entityType: "calendar_event",
    entityId: event.id,
    emailOverride: opts.reminder === true,
  });
  return userIds.length;
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
    const stored = events.map((e) => ({ ...eventView(e), can_manage: managerAll || e.authorId === request.user!.id, birthday: false }));

    // Anniversaires automatiques : événements virtuels (non stockés) déduits de
    // la date de naissance des collaborateurs. Visibles de tous ; on n'affiche
    // que le jour et le mois (jamais l'année de naissance ni l'âge).
    const birthdays = await buildBirthdayEvents(from, to);

    return reply.send([...stored, ...birthdays].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()));
  });

  // ── Anniversaires du JOUR (pour l'encart du tableau de bord) ───────────────
  // Ne renvoie que les anniversaires d'aujourd'hui : l'encart ne « sort » donc
  // que le jour même, jamais à l'avance ni toute l'année. Aucune date de
  // naissance n'est exposée — seulement le nom des personnes fêtées.
  fastify.get("/api/v1/calendar/today-birthdays", { preHandler: requirePermission("communication", "consultation") }, async (_request, reply) => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);
    const birthdays = await buildBirthdayEvents(start, end);
    return reply.send(birthdays.map((b) => ({ id: b.id, name: b.person })));
  });

  // ── Événements à venir (encart du tableau de bord) ─────────────────────────
  // Les prochains événements qui me concernent, dans une fenêtre courte (7 jours
  // par défaut) : rappel « à venir » sans planificateur, calculé à la demande.
  fastify.get("/api/v1/calendar/upcoming", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const days = Math.min(31, Math.max(1, Number((request.query as { days?: string }).days) || 7));
    const now = new Date();
    const until = new Date(now.getTime() + days * 86_400_000);

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
      where: { deletedAt: null, startsAt: { gte: now, lt: until }, ...visibility },
      orderBy: { startsAt: "asc" },
      take: 8,
      include: { author: { select: { id: true, username: true } } },
    });
    return reply.send(events.map((e) => eventView(e)));
  });

  // ── Bandeau « Programme à venir » du Hall (rappel discret, D-029) ──────────
  // Renvoie la configuration (paramétrable) + les événements à venir qui me
  // concernent (agenda + anniversaires), sur l'horizon configuré, enrichis
  // d'une priorité (urgent / aujourd'hui / ce mois / plus tard) et du délai en
  // minutes. Le passé est retiré ; les urgents sont mis en tête.
  fastify.get("/api/v1/calendar/agenda-banner", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const config = await getHallAgendaConfig();
    if (!config.enabled) return reply.send({ config, events: [] });

    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const until = new Date(now.getTime() + config.horizonDays * 86_400_000);

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

    const stored = await prisma.calendarEvent.findMany({
      where: { deletedAt: null, startsAt: { gte: startOfToday, lt: until }, ...visibility },
      orderBy: { startsAt: "asc" },
    });
    const birthdays = await buildBirthdayEvents(startOfToday, until);

    // Événements du « Planning des événements » (dédicaces, salons, lancements…)
    // cochés « à faire défiler » et encore à venir. Le Planning n'a pas de
    // ciblage par pôle : ce sont des événements de la maison, diffusés à tous.
    // Les événements internes (ex. voyages du DG) se retirent en décochant la
    // case « Afficher dans le bandeau » sur la fiche de l'événement.
    const annual = await prisma.annualEvent.findMany({
      where: { deletedAt: null, showInBanner: true, status: { in: ["a_venir", "a_confirmer"] }, startDate: { lt: until } },
      orderBy: { startDate: "asc" },
    });

    type Raw = { id: string; title: string; type: string; starts_at: Date | string; ends_at: Date | string | null; all_day: boolean; location: string | null; birthday: boolean; person: string | null };
    const raw: Raw[] = [
      ...stored.map((e) => ({ id: e.id, title: e.title, type: e.type as string, starts_at: e.startsAt, ends_at: null, all_day: e.allDay, location: e.location, birthday: false, person: null })),
      ...birthdays.map((b) => ({ id: b.id, title: b.title, type: b.type, starts_at: b.starts_at, ends_at: null, all_day: b.all_day, location: b.location, birthday: true, person: b.person })),
      ...annual.map((e) => ({ id: `annual:${e.id}`, title: e.title, type: annualEventIcon(e.title, e.description), starts_at: e.startDate, ends_at: e.endDate ?? e.startDate, all_day: true, location: e.location, birthday: false, person: null })),
    ];

    const enriched = raw
      .map((e) => {
        const start = new Date(e.starts_at);
        // Fin de référence : la date de fin (fin de journée) si l'événement en a
        // une — cas des événements sur plusieurs jours (salon 12→13 déc.) —, sinon
        // fin de journée pour un « journée entière », sinon le début. Sert à
        // retirer les événements passés.
        const endBase = e.ends_at ? new Date(e.ends_at) : e.all_day ? start : null;
        const refEnd = endBase
          ? new Date(Date.UTC(endBase.getUTCFullYear(), endBase.getUTCMonth(), endBase.getUTCDate(), 23, 59, 59))
          : start;
        const minutesUntil = Math.round((start.getTime() - now.getTime()) / 60000);
        const sameDay =
          start.getUTCFullYear() === now.getUTCFullYear() && start.getUTCMonth() === now.getUTCMonth() && start.getUTCDate() === now.getUTCDate();
        let priority: "urgent" | "today" | "month" | "later";
        if (!e.all_day && minutesUntil >= 0 && minutesUntil <= config.urgentMinutes) priority = "urgent";
        else if (sameDay) priority = "today";
        else if (start.getUTCFullYear() === now.getUTCFullYear() && start.getUTCMonth() === now.getUTCMonth()) priority = "month";
        else priority = "later";
        return {
          id: e.id,
          title: e.title,
          type: e.type,
          starts_at: start.toISOString(),
          all_day: e.all_day,
          location: e.location,
          birthday: e.birthday,
          person: e.person,
          minutes_until: e.all_day ? null : minutesUntil,
          priority,
          refEnd,
        };
      })
      .filter((e) => e.refEnd.getTime() >= now.getTime()) // le passé disparaît automatiquement
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

    const urgent = enriched.filter((e) => e.priority === "urgent");
    const rest = enriched.filter((e) => e.priority !== "urgent");
    const events = [...urgent, ...rest].slice(0, 20).map(({ refEnd: _refEnd, ...e }) => e);
    return reply.send({ config, events });
  });

  // Configuration du bandeau : lecture ouverte (le bandeau tourne chez chacun),
  // écriture réservée à l'administration du babillard (D-027 : DG, RH, Admin).
  fastify.get("/api/v1/calendar/banner-config", { preHandler: requirePermission("communication", "consultation") }, async (_request, reply) => {
    return reply.send(await getHallAgendaConfig());
  });

  fastify.put("/api/v1/calendar/banner-config", { preHandler: requirePermission("communication", "administration") }, async (request, reply) => {
    const parsed = z
      .object({
        enabled: z.boolean(),
        reappearMinutes: z.number().int().min(1).max(240),
        capsuleSeconds: z.number().int().min(2).max(60),
        horizonDays: z.number().int().min(1).max(365),
        urgentMinutes: z.number().int().min(1).max(240),
      })
      .safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const saved = await setHallAgendaConfig(parsed.data);
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "hall_agenda_config", entityId: "hall_agenda_config", newValues: { ...parsed.data }, ipAddress: request.ip });
    return reply.send(saved);
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

    // Notifie l'audience du nouvel événement (cloche + e-mail si échéance).
    await notifyEventAudience(created, d.targets.map((t) => ({ targetType: t.type, targetId: t.type === "tous" ? null : t.id! }))).catch(() => {});

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

  // ── Rappel manuel aux participants (auteur ou administration) ──────────────
  fastify.post("/api/v1/calendar/events/:id/remind", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await loadManageable(request, reply, id);
    if (!event) return;
    const targets = await prisma.calendarEventTarget.findMany({ where: { eventId: id }, select: { targetType: true, targetId: true } });
    const reminded = await notifyEventAudience(event, targets, { reminder: true });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "calendar_event",
      entityId: id,
      newValues: { reminder: true, reminded },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true, reminded });
  });
}
