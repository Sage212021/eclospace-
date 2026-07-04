import type { Prisma, AuditAction } from "@prisma/client";
import { prisma } from "./prisma.js";

interface AuditEntryInput {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValues?: Prisma.InputJsonValue | null;
  newValues?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
}

// Toute écriture est journalisée (spécification API §1, modèle §3.6).
// audit_log est append-only : on ne fait jamais que des INSERT (voir migration
// append_only_constraints qui interdit UPDATE/DELETE au niveau base).
export async function writeAuditLog(entry: AuditEntryInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValues: entry.oldValues ?? undefined,
      newValues: entry.newValues ?? undefined,
      ipAddress: entry.ipAddress ?? undefined,
    },
  });
}
