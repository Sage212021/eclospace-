import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyPermission } from "../lib/permissions.js";
import { buildConnectionRecord, monthBoundsUtc, type ConnectionEvent } from "../lib/erpConnections.js";

// Relevé des connexions ERP (spec opérateur 12/08/2026) — remplace l'ancien
// module « Anomalies de présence ». Simple CONSULTATION, à partir des traces
// login/logout du journal d'audit. AUCUN impact sur la paie : les connexions
// ERP ne sont ni un pointage, ni une preuve de présence — seulement un élément
// technique indicatif et un outil d'arbitrage pour le RH.

// Habilitations : réservé aux profils qui SUPERVISENT la présence (RH, direction,
// chef de département). La simple « consultation » est accordée à tout salarié
// pour voir SA propre présence — on ne l'ouvre donc pas ici, car ce relevé porte
// sur un collègue (donnée sensible, usage d'arbitrage RH).
const CONSULT = requireAnyPermission([
  { module: "presences", action: "validation" },
  { module: "presences", action: "administration" },
]);

const querySchema = z.object({
  employee_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export default async function erpConnectionsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/hr/erp-connections", { preHandler: CONSULT }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres requis : employee_id (UUID) et month (AAAA-MM)." });
    }
    const { employee_id, month } = parsed.data;

    const employee = await prisma.employee.findFirst({
      where: { id: employee_id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, user: { select: { id: true } } },
    });
    if (!employee) return reply.code(404).send({ code: "not_found", message: "Employé introuvable." });

    const employeeName = `${employee.firstName} ${employee.lastName}`;
    const hasErpAccount = Boolean(employee.user);

    // Sans compte ERP relié, aucune connexion possible : relevé vide (jamais une erreur).
    let events: ConnectionEvent[] = [];
    if (employee.user) {
      const { start, end } = monthBoundsUtc(month);
      const rows = await prisma.auditLog.findMany({
        where: { userId: employee.user.id, action: { in: ["login", "logout"] }, occurredAt: { gte: start, lt: end } },
        select: { occurredAt: true, action: true },
        orderBy: { occurredAt: "asc" },
      });
      events = rows.map((r) => ({ occurredAt: r.occurredAt, kind: r.action as "login" | "logout" }));
    }

    const record = buildConnectionRecord(month, events);
    return reply.send({
      employee: { id: employee.id, name: employeeName, has_erp_account: hasErpAccount },
      ...record,
      // Rappel explicite renvoyé à l'interface : aucune exploitation automatique.
      notice: "Données indicatives (connexions ERP). Ce relevé n'est pas un pointage et n'a aucun effet sur la paie : les références officielles restent le pointeur physique et le registre manuel signé.",
    });
  });
}
