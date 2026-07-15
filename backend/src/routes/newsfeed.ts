import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { announcementPreview } from "../lib/announcementHtml.js";

// Centre de Communication Interne — Fil d'actualités (module « communication »).
// Vue agrégée, en lecture seule, du « quoi de neuf » qui me concerne : annonces
// publiées récentes + événements du calendrier proches, fusionnés en une seule
// chronologie. N'introduit aucune table : réutilise les reçus d'annonces (pour
// la visibilité et le statut lu) et la visibilité des événements.

const WINDOW_DAYS = 45;

export default async function newsfeedRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/newsfeed", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const userId = request.user!.id;
    const now = new Date();
    const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const to = new Date(now.getTime() + WINDOW_DAYS * 86_400_000);

    // ── Annonces qui me ciblent (via mes reçus), publiées dans la fenêtre ──────
    const receipts = await prisma.announcementReceipt.findMany({
      where: {
        userId,
        announcement: { deletedAt: null, status: "publiee", publishedAt: { gte: from } },
      },
      include: { announcement: { include: { category: true, author: { select: { username: true } } } } },
    });
    const announcementItems = receipts.map((r) => ({
      kind: "announcement" as const,
      id: r.announcement.id,
      title: r.announcement.title,
      date: r.announcement.publishedAt,
      preview: announcementPreview(r.announcement.bodyHtml, 140),
      priority: r.announcement.priority,
      category: r.announcement.category?.code ?? null,
      author: r.announcement.author?.username ?? null,
      read: Boolean(r.readAt),
    }));

    // ── Événements du calendrier qui me concernent, dans la fenêtre ────────────
    let visibility: Prisma.CalendarEventWhereInput = {};
    if (!request.user!.permissions.has("communication:administration")) {
      const [user, roles] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { employee: { select: { departmentId: true } } } }),
        prisma.userRole.findMany({ where: { userId, revokedAt: null }, select: { roleId: true } }),
      ]);
      const departmentId = user?.employee?.departmentId ?? null;
      const roleIds = roles.map((r) => r.roleId);
      visibility = {
        targets: {
          some: {
            OR: [
              { targetType: "tous" },
              ...(departmentId ? [{ targetType: "departement" as const, targetId: departmentId }] : []),
              ...(roleIds.length ? [{ targetType: "role" as const, targetId: { in: roleIds } }] : []),
              { targetType: "utilisateur" as const, targetId: userId },
            ],
          },
        },
      };
    }
    const events = await prisma.calendarEvent.findMany({
      where: { deletedAt: null, startsAt: { gte: from, lt: to }, ...visibility },
      include: { author: { select: { username: true } } },
    });
    const eventItems = events.map((e) => ({
      kind: "event" as const,
      id: e.id,
      title: e.title,
      date: e.startsAt,
      preview: [e.location, e.description].filter(Boolean).join(" · ") || null,
      event_type: e.type,
      all_day: e.allDay,
      author: e.author?.username ?? null,
    }));

    // Fusion et tri chronologique décroissant : les événements à venir remontent
    // en tête, suivis des annonces et événements récents.
    const items = [...announcementItems, ...eventItems].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return reply.send(items.slice(0, 60));
  });
}
