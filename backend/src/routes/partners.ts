import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PartnerCategory } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

const createPartnerSchema = z.object({
  category: z.nativeEnum(PartnerCategory),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  pen_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const listQuerySchema = z.object({
  category: z.nativeEnum(PartnerCategory).optional(),
});

// Fiche Partenaire unique (auteur, correcteur, traducteur, illustrateur,
// maquettiste, graphiste, imprimeur, consultant, autre — décision opérateur
// du 04/07/2026) : couvre les contreparties de contrats (Ch. 9 §9.3) sans
// nécessiter une refonte à chaque nouveau type de prestataire.
export default async function partnerRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/partners", { preHandler: requirePermission("contracts", "consultation") }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const partners = await prisma.partner.findMany({
      where: { deletedAt: null, ...(parsed.data.category ? { category: parsed.data.category } : {}) },
      orderBy: { lastName: "asc" },
    });
    return reply.send(partners);
  });

  fastify.post("/api/v1/partners", { preHandler: requirePermission("contracts", "saisie") }, async (request, reply) => {
    const parsed = createPartnerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }

    const partner = await prisma.partner.create({
      data: {
        category: parsed.data.category,
        firstName: parsed.data.first_name,
        lastName: parsed.data.last_name,
        penName: parsed.data.pen_name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        address: parsed.data.address,
        createdBy: request.user!.id,
        updatedBy: request.user!.id,
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "partner",
      entityId: partner.id,
      newValues: { category: parsed.data.category },
      ipAddress: request.ip,
    });

    return reply.code(201).send(partner);
  });
}
