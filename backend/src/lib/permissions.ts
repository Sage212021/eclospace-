import type { FastifyReply, FastifyRequest } from "fastify";
import type { PermissionAction } from "@prisma/client";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";

export interface EffectiveUser {
  id: string;
  username: string;
  email: string;
  status: string;
  mfaEnabled: boolean;
  roles: string[];
  permissions: Set<string>; // "module:action"
}

function permKey(module: string, action: string): string {
  return `${module}:${action}`;
}

// Autorisation évaluée côté serveur à chaque appel (Ch. 21 §21.4) : on ne fait
// jamais confiance à un rôle mis en cache côté client. Requêté frais à chaque
// résolution de session — volumétrie Lot 0 négligeable pour la base.
export async function loadEffectiveUser(userId: string): Promise<EffectiveUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    include: {
      employee: true,
      userRoles: {
        where: { revokedAt: null },
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } },
          },
        },
      },
    },
  });

  if (!user) return null;

  // Ch. 19 §19.3 : désactivation automatique du compte à la date de départ
  // du dossier RH — aucune tâche planifiée n'existe dans le projet (cf.
  // docs/JOURNAL_TECHNIQUE.md), donc vérifiée de façon paresseuse à chaque
  // résolution de session plutôt qu'à une heure précise.
  if (user.status === "active" && user.employee?.departureDate && user.employee.departureDate <= new Date()) {
    await prisma.user.update({ where: { id: userId }, data: { status: "disabled" } });
    return null;
  }

  if (user.status !== "active") return null;

  const roles = new Set<string>();
  const permissions = new Set<string>();
  for (const userRole of user.userRoles) {
    roles.add(userRole.role.code);
    for (const rolePermission of userRole.role.rolePermissions) {
      permissions.add(permKey(rolePermission.permission.module, rolePermission.permission.action));
    }
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    roles: [...roles],
    permissions,
  };
}

// Les preHandlers Fastify doivent être async (ou accepter un callback `done`) :
// une fonction sync à deux arguments laisse la requête en attente indéfiniment.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    reply.code(401).send({ code: "unauthenticated", message: "Connexion requise." });
  }
}

export function requirePermission(module: string, action: PermissionAction) {
  return async function permissionPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ code: "unauthenticated", message: "Connexion requise." });
      return;
    }
    if (!request.user.permissions.has(permKey(module, action))) {
      // Tentative d'accès refusée (Ch. 21 §21.6) : tracée au journal inviolable
      // pour la sécurité, avec la permission manquante et la cible visée. Sans
      // bloquer la réponse (journalisation en arrière-plan) et sans jamais faire
      // échouer la requête si l'écriture du journal échoue.
      const req = request;
      void writeAuditLog({
        userId: req.user!.id,
        action: "access_denied",
        entityType: "permission",
        entityId: permKey(module, action),
        newValues: { method: req.method, url: req.url },
        ipAddress: req.ip,
      }).catch(() => {});
      reply.code(403).send({
        code: "forbidden",
        message: `Action non autorisée : ${module}:${action} requis.`,
      });
    }
  };
}
