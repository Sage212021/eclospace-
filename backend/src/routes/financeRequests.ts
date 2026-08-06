import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ManuscriptFinanceRequestType, ManuscriptFinanceRequestStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Demandes Finance émises depuis la fiche manuscrit (point 6 du chantier
// « contrat & manuscrit ») : « Demande de devis » et « Demande de facture —
// frais de dépôt ». L'éditorial clique, le financier reçoit la demande dans sa
// file et établit le devis / la facture, puis la marque traitée.
export default async function financeRequestRoutes(fastify: FastifyInstance) {
  // Émettre une demande depuis un manuscrit (éditorial / saisie manuscrits).
  fastify.post("/api/v1/manuscripts/:id/finance-requests", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ type: z.nativeEnum(ManuscriptFinanceRequestType), note: z.string().max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });

    // Anti-doublon : une demande ouverte du même type suffit (évite d'inonder la
    // Finance de demandes identiques). Message explicite si déjà en cours.
    const existing = await prisma.manuscriptFinanceRequest.findFirst({ where: { manuscriptId: id, type: parsed.data.type, status: "requested" } });
    if (existing) {
      const label = parsed.data.type === "devis" ? "devis" : "facture de frais de dépôt";
      return reply.code(409).send({ code: "request_pending", message: `Une demande de ${label} est déjà en attente pour cet ouvrage.` });
    }

    const created = await prisma.manuscriptFinanceRequest.create({
      data: { manuscriptId: id, type: parsed.data.type, note: parsed.data.note, requestedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "manuscript_finance_request", entityId: created.id, newValues: { manuscriptId: id, type: parsed.data.type }, ipAddress: request.ip });
    return reply.code(201).send(created);
  });

  // Demandes d'un manuscrit (visibles sur la fiche).
  fastify.get("/api/v1/manuscripts/:id/finance-requests", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.manuscriptFinanceRequest.findMany({ where: { manuscriptId: id }, orderBy: { requestedAt: "desc" } });
    return reply.send(rows);
  });

  // File Finance : demandes reçues (par défaut, celles en attente) avec le titre
  // de l'ouvrage et l'auteur, pour établir le devis / la facture.
  fastify.get("/api/v1/finance-requests", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const statusQ = (request.query as { status?: string }).status;
    const where = statusQ && (Object.values(ManuscriptFinanceRequestStatus) as string[]).includes(statusQ) ? { status: statusQ as ManuscriptFinanceRequestStatus } : { status: "requested" as ManuscriptFinanceRequestStatus };
    const rows = await prisma.manuscriptFinanceRequest.findMany({
      where,
      orderBy: { requestedAt: "asc" },
      include: {
        manuscript: {
          select: {
            id: true,
            manuscriptNumber: true,
            title: true,
            fundingMode: true,
            workContributors: { where: { role: "author" }, include: { partner: { select: { firstName: true, lastName: true } } }, take: 1 },
          },
        },
      },
    });
    return reply.send(rows.map((r) => {
      const author = r.manuscript.workContributors[0]?.partner;
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        note: r.note,
        requested_at: r.requestedAt,
        manuscript_id: r.manuscript.id,
        manuscript_number: r.manuscript.manuscriptNumber,
        title: r.manuscript.title,
        funding_mode: r.manuscript.fundingMode,
        author: author ? `${author.firstName} ${author.lastName}` : null,
      };
    }));
  });

  // Traitement d'une demande par la Finance (établie → traitée, ou rejetée).
  fastify.patch("/api/v1/finance-requests/:id", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.enum(["processed", "rejected"]), resolution: z.string().max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Statut invalide.", details: parsed.error.issues });
    const existing = await prisma.manuscriptFinanceRequest.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    const updated = await prisma.manuscriptFinanceRequest.update({
      where: { id },
      data: { status: parsed.data.status, resolution: parsed.data.resolution, processedBy: request.user!.id, processedAt: new Date() },
    });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "manuscript_finance_request", entityId: id, newValues: { status: parsed.data.status }, ipAddress: request.ip });
    return reply.send(updated);
  });
}
