import { prisma } from "./prisma.js";
import type { NotificationPriority, NotificationType } from "@prisma/client";

interface RoleNotificationInput {
  roleCode: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
}

// Diffusion à tous les titulaires actifs d'un rôle (ex. alertes BAT/impression
// à la Direction ou au responsable impression, Ch. 14 §14.10, Ch. 15).
export async function notifyRole(input: RoleNotificationInput): Promise<void> {
  const userRoles = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { code: input.roleCode } },
    select: { userId: true },
  });
  await prisma.notification.createMany({
    data: userRoles.map((userRole) => ({
      userId: userRole.userId,
      type: input.type,
      priority: input.priority,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
    })),
  });
}
