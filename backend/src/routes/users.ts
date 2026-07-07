import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";

// Comptes et habilitations (Ch. 2). La liste minimale des comptes actifs sert
// aux sélecteurs "responsable du dossier" / "lecteur affecté" (Ch. 6, Ch. 7) ;
// l'attribution/retrait de rôle vit dans hr.ts. Les deux routes de lecture
// ci-dessous alimentent l'écran dédié « Utilisateurs & rôles ».
export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/users", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, status: "active" },
      select: { id: true, username: true, email: true },
      orderBy: { username: "asc" },
    });
    return reply.send(users);
  });

  // Référentiel des rôles applicatifs (Ch. 2 §2.2) — pour le sélecteur
  // d'attribution de rôle de l'écran Utilisateurs & rôles.
  fastify.get("/api/v1/roles", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const roles = await prisma.role.findMany({
      include: { department: { select: { name: true } } },
      orderBy: { label: "asc" },
    });
    return reply.send(
      roles.map((r) => ({ id: r.id, code: r.code, label: r.label, department: r.department?.name ?? null })),
    );
  });

  // Comptes avec leurs rôles actifs (Ch. 2 §2.4) — vue consolidée pour la
  // gestion des habilitations.
  fastify.get("/api/v1/users-with-roles", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        userRoles: {
          where: { revokedAt: null },
          select: { id: true, role: { select: { code: true, label: true } } },
        },
      },
      orderBy: { username: "asc" },
    });
    return reply.send(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        status: u.status,
        roles: u.userRoles.map((ur) => ({ userRoleId: ur.id, code: ur.role.code, label: ur.role.label })),
      })),
    );
  });
}
