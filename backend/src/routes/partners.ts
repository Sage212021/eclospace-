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
  // Numéro WhatsApp (facultatif) — coordonnée de notification de la contrepartie.
  whatsapp: z.string().max(40).optional(),
  address: z.string().optional(),
});

// Modification des coordonnées d'un partenaire. On ne touche qu'aux champs de
// contact/identité (jamais la catégorie, qui structure le circuit contractuel).
// Un champ omis reste inchangé ; une chaîne vide efface la coordonnée.
const updatePartnerSchema = z
  .object({
    pen_name: z.string().max(200).nullish(),
    email: z.union([z.string().email(), z.literal("")]).nullish(),
    phone: z.string().max(40).nullish(),
    whatsapp: z.string().max(40).nullish(),
    address: z.string().max(500).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à modifier." });

const listQuerySchema = z.object({
  category: z.nativeEnum(PartnerCategory).optional(),
});

// Normalise une valeur texte optionnelle : chaîne vide → null (efface).
function toNullable(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

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
        whatsapp: parsed.data.whatsapp,
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

  // Mise à jour des coordonnées d'un partenaire (e-mail, téléphone, WhatsApp,
  // adresse, nom de plume). Tracée au journal avec l'ancien et le nouveau
  // contenu des champs modifiés (traçabilité — qui a changé quoi).
  fastify.patch("/api/v1/partners/:id", { preHandler: requirePermission("contracts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updatePartnerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const existing = await prisma.partner.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Fiche partenaire introuvable." });

    const data: Record<string, string | null> = {};
    if ("pen_name" in parsed.data) data.penName = toNullable(parsed.data.pen_name) ?? null;
    if ("email" in parsed.data) data.email = toNullable(parsed.data.email) ?? null;
    if ("phone" in parsed.data) data.phone = toNullable(parsed.data.phone) ?? null;
    if ("whatsapp" in parsed.data) data.whatsapp = toNullable(parsed.data.whatsapp) ?? null;
    if ("address" in parsed.data) data.address = toNullable(parsed.data.address) ?? null;

    // Champs réellement modifiés, pour un journal d'audit lisible.
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(data)) {
      const prev = ((existing as unknown as Record<string, string | null>)[key] ?? null) as string | null;
      if (prev !== value) {
        before[key] = prev;
        after[key] = value;
      }
    }

    const updated = await prisma.partner.update({
      where: { id },
      data: { ...data, updatedBy: request.user!.id },
    });

    if (Object.keys(after).length > 0) {
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "partner",
        entityId: id,
        oldValues: before,
        newValues: after,
        ipAddress: request.ip,
      });
    }

    return reply.send(updated);
  });
}
