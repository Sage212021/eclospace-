import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { validatePasswordComplexity } from "../lib/passwordPolicy.js";

const resetPasswordSchema = z.object({ new_password: z.string().min(1) });

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

  // Réinitialisation du mot de passe par un administrateur (Ch. 2, sécurité des
  // comptes). Réservé au niveau « administration » : l'admin fixe un nouveau
  // mot de passe pour un compte (ex. utilisateur ayant perdu le sien). Le
  // nouveau mot de passe doit respecter les règles de complexité ; l'opération
  // est tracée au journal d'audit sans jamais y inscrire le mot de passe.
  fastify.post(
    "/api/v1/users/:id/reset-password",
    { preHandler: requirePermission("users", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
      if (!target) {
        return reply.code(404).send({ code: "not_found", message: "Compte introuvable." });
      }

      const complexityError = validatePasswordComplexity(parsed.data.new_password);
      if (complexityError) {
        return reply.code(400).send({ code: "weak_password", message: complexityError });
      }

      const passwordHash = await argon2.hash(parsed.data.new_password);
      await prisma.user.update({ where: { id: target.id }, data: { passwordHash } });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "user",
        entityId: target.id,
        newValues: { change: "password_reset_by_admin" },
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );
}
