import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrimeType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { syncPayrollLinePrimes } from "../lib/payrollPrimes.js";

// Module « Primes du mois » (demande opérateur 09/09/2026). Le RH ajoute des
// primes individuelles (type, montant, motif, date, observation), les modifie /
// supprime tant qu'elles sont « à valider », puis les VALIDE : la prime est alors
// intégrée automatiquement à la paie du mois (source unique du champ « primes »
// de la ligne de paie) et verrouillée. Une prime validée peut être ANNULÉE tant
// que la paie du mois n'est pas soumise/validée par la Direction.

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = z.number().positive().max(1_000_000_000);

const createSchema = z.object({
  employee_id: z.string().uuid(),
  period: z.string().regex(PERIOD_RE, "Mois attendu au format AAAA-MM."),
  type: z.nativeEnum(PrimeType),
  amount: money,
  motif: z.string().max(300).optional(),
  date_awarded: z.string().datetime().optional(),
  observation: z.string().max(500).optional(),
});

const updateSchema = z.object({
  period: z.string().regex(PERIOD_RE).optional(),
  type: z.nativeEnum(PrimeType).optional(),
  amount: money.optional(),
  motif: z.string().max(300).nullable().optional(),
  date_awarded: z.string().datetime().optional(),
  observation: z.string().max(500).nullable().optional(),
});

// Un mois est verrouillé pour l'intégration des primes dès qu'il est soumis au DG
// ou validé (cohérent avec la grille de paie et le circuit D-016).
async function runLockMessage(periodKey: string): Promise<string | null> {
  const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey } });
  if (!run) return null;
  if (run.status === "valide") return "La paie de ce mois est déjà validée. Demandez sa réouverture au DG pour intégrer cette prime.";
  if (run.status === "soumis_dg") return "La paie de ce mois est soumise au Directeur général. Elle doit être validée ou retournée avant d'intégrer une nouvelle prime.";
  return null;
}

function serialize(p: {
  id: string; employeeId: string; periodKey: string; type: PrimeType; amount: unknown; motif: string | null;
  dateAwarded: Date; observation: string | null; status: string; validatedAt: Date | null; createdAt: Date;
  employee?: { firstName: string; lastName: string } | null;
}) {
  return {
    id: p.id,
    employee_id: p.employeeId,
    employee_name: p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : null,
    period: p.periodKey,
    type: p.type,
    amount: Number(p.amount),
    motif: p.motif,
    date_awarded: p.dateAwarded,
    observation: p.observation,
    status: p.status,
    validated_at: p.validatedAt,
    created_at: p.createdAt,
  };
}

export default async function primeRoutes(fastify: FastifyInstance) {
  // Liste des primes (filtrable par mois et par salarié), les plus récentes d'abord.
  fastify.get("/api/v1/primes", { preHandler: requirePermission("paie", "consultation") }, async (request, reply) => {
    const q = request.query as { period?: string; employee_id?: string };
    const primes = await prisma.prime.findMany({
      where: {
        deletedAt: null,
        ...(q.period && PERIOD_RE.test(q.period) ? { periodKey: q.period } : {}),
        ...(q.employee_id ? { employeeId: q.employee_id } : {}),
      },
      orderBy: [{ periodKey: "desc" }, { createdAt: "desc" }],
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return reply.send(primes.map(serialize));
  });

  // Ajouter une prime (statut « à valider »).
  fastify.post("/api/v1/primes", { preHandler: requirePermission("paie", "saisie") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employee_id, deletedAt: null }, select: { id: true } });
    if (!employee) return reply.code(404).send({ code: "not_found", message: "Salarié introuvable." });

    const created = await prisma.prime.create({
      data: {
        employeeId: parsed.data.employee_id,
        periodKey: parsed.data.period,
        type: parsed.data.type,
        amount: parsed.data.amount,
        motif: parsed.data.motif,
        dateAwarded: parsed.data.date_awarded ? new Date(parsed.data.date_awarded) : new Date(),
        observation: parsed.data.observation,
        createdBy: request.user!.id,
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "prime", entityId: created.id, newValues: { period: created.periodKey, type: created.type, amount: Number(created.amount) }, ipAddress: request.ip });
    return reply.code(201).send(serialize(created));
  });

  // Modifier une prime — uniquement tant qu'elle est « à valider ».
  fastify.patch("/api/v1/primes/:id", { preHandler: requirePermission("paie", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const prime = await prisma.prime.findFirst({ where: { id, deletedAt: null } });
    if (!prime) return reply.code(404).send({ code: "not_found", message: "Prime introuvable." });
    if (prime.status !== "a_valider") return reply.code(409).send({ code: "not_editable", message: "Seule une prime « à valider » peut être modifiée. Annulez-la d'abord si elle est validée." });

    const d = parsed.data;
    const updated = await prisma.prime.update({
      where: { id },
      data: {
        ...(d.period ? { periodKey: d.period } : {}),
        ...(d.type ? { type: d.type } : {}),
        ...(d.amount != null ? { amount: d.amount } : {}),
        ...(d.motif !== undefined ? { motif: d.motif } : {}),
        ...(d.date_awarded ? { dateAwarded: new Date(d.date_awarded) } : {}),
        ...(d.observation !== undefined ? { observation: d.observation } : {}),
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "prime", entityId: id, newValues: d, ipAddress: request.ip });
    return reply.send(serialize(updated));
  });

  // Supprimer (logiquement) une prime — uniquement tant qu'elle est « à valider ».
  fastify.delete("/api/v1/primes/:id", { preHandler: requirePermission("paie", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const prime = await prisma.prime.findFirst({ where: { id, deletedAt: null } });
    if (!prime) return reply.code(404).send({ code: "not_found", message: "Prime introuvable." });
    if (prime.status !== "a_valider") return reply.code(409).send({ code: "not_deletable", message: "Une prime validée ne peut pas être supprimée. Annulez-la (elle sera retirée de la paie) si nécessaire." });
    await prisma.prime.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "prime", entityId: id, newValues: { deleted: true }, ipAddress: request.ip });
    return reply.code(204).send();
  });

  // Valider une prime → intégrée automatiquement à la paie du mois. Refusé si la
  // paie du mois est déjà soumise / validée (verrouillée).
  fastify.post("/api/v1/primes/:id/validate", { preHandler: requirePermission("paie", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const prime = await prisma.prime.findFirst({ where: { id, deletedAt: null } });
    if (!prime) return reply.code(404).send({ code: "not_found", message: "Prime introuvable." });
    if (prime.status === "validee") return reply.code(409).send({ code: "already_validated", message: "Cette prime est déjà validée." });
    if (prime.status !== "a_valider") return reply.code(409).send({ code: "invalid_status", message: "Seule une prime « à valider » peut être validée." });
    const lock = await runLockMessage(prime.periodKey);
    if (lock) return reply.code(409).send({ code: "run_locked", message: lock });

    const updated = await prisma.prime.update({
      where: { id },
      data: { status: "validee", validatedBy: request.user!.id, validatedAt: new Date() },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    // Intégration automatique à la paie du mois (source unique des primes).
    await syncPayrollLinePrimes(prime.periodKey, prime.employeeId);
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "prime", entityId: id, newValues: { status: "validee" }, ipAddress: request.ip });
    return reply.send(serialize(updated));
  });

  // Annuler une prime VALIDÉE (correction) → retirée de la paie du mois. Refusé si
  // la paie du mois est soumise / validée (il faut d'abord la rouvrir).
  fastify.post("/api/v1/primes/:id/cancel", { preHandler: requirePermission("paie", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const prime = await prisma.prime.findFirst({ where: { id, deletedAt: null } });
    if (!prime) return reply.code(404).send({ code: "not_found", message: "Prime introuvable." });
    if (prime.status !== "validee") return reply.code(409).send({ code: "invalid_status", message: "Seule une prime validée peut être annulée." });
    const lock = await runLockMessage(prime.periodKey);
    if (lock) return reply.code(409).send({ code: "run_locked", message: lock });

    const updated = await prisma.prime.update({
      where: { id },
      data: { status: "annulee" },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    await syncPayrollLinePrimes(prime.periodKey, prime.employeeId);
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "prime", entityId: id, newValues: { status: "annulee" }, ipAddress: request.ip });
    return reply.send(serialize(updated));
  });
}
