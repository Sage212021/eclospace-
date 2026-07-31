import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IsbnFormat, LegalDepositStatus, MetadataExportFormat, ContractStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { computeEan13CheckDigit, isbn13ToBarcodeSvg } from "../lib/barcode.js";
import { computeIsbnCompleteness } from "../lib/isbnCompleteness.js";

// Ch. 13 §13.2 : alerte paramétrable quand le stock d'ISBN disponibles
// passe sous ce seuil (clé settings, valeur de départ documentée en Lot 3).
async function isbnStockAlertThreshold(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: "isbn_stock_alert_threshold" } });
  return (setting?.value as number | undefined) ?? 20;
}

function poolAvailableCount(pool: { rangeStart: number; rangeEnd: number; nextValue: number }): number {
  return Math.max(0, pool.rangeEnd - pool.nextValue + 1);
}

const isbnPoolSchema = z.object({
  prefix: z.string().min(1),
  digit_width: z.number().int().positive().default(3),
  range_start: z.number().int().nonnegative(),
  range_end: z.number().int().nonnegative(),
});

const isbnAttributionSchema = z.object({
  format: z.nativeEnum(IsbnFormat),
  pool_id: z.string().uuid().optional(),
});

const legalDepositSchema = z.object({
  country: z.string().min(1),
  depository: z.string().min(1),
  copies_required: z.number().int().positive(),
  due_date: z.string().datetime().optional(),
});

const legalDepositUpdateSchema = z.object({
  status: z.nativeEnum(LegalDepositStatus).optional(),
  deposited_at: z.string().datetime().optional(),
  deposit_number: z.string().optional(),
  receipt_document_id: z.string().uuid().optional(),
});

const workMetadataSchema = z.object({
  weight_grams: z.number().int().positive().optional(),
  summary: z.string().optional(),
  author_bio: z.string().optional(),
  public_target: z.string().optional(),
  age_range: z.string().optional(),
  thema_codes: z.array(z.string()).optional(),
  price_by_country: z.record(z.unknown()).optional(),
});

const metadataExportSchema = z.object({
  format: z.nativeEnum(MetadataExportFormat),
  partner_id: z.string().uuid().optional(),
});

// Ch. 13 : identité officielle (ISBN), obligations légales (dépôt légal) et
// métadonnées de diffusion — point de passage obligé avant le BAT (Ch. 14).
export default async function isbnRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/isbn-pools", { preHandler: requirePermission("isbn", "consultation") }, async (request, reply) => {
    const pools = await prisma.isbnPool.findMany({ orderBy: { receivedAt: "desc" } });
    const threshold = await isbnStockAlertThreshold();
    const totalAvailable = pools.reduce((sum, pool) => sum + poolAvailableCount(pool), 0);
    return reply.send({
      pools: pools.map((pool) => ({ ...pool, available: poolAvailableCount(pool) })),
      total_available: totalAvailable,
      alert_threshold: threshold,
      low_stock: totalAvailable < threshold,
    });
  });

  fastify.post("/api/v1/isbn-pools", { preHandler: requirePermission("isbn", "administration") }, async (request, reply) => {
    const parsed = isbnPoolSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    if (body.range_end < body.range_start) {
      return reply.code(400).send({ code: "validation_error", message: "La fin de plage doit être postérieure au début." });
    }
    if (body.prefix.length + body.digit_width + 1 !== 13) {
      return reply.code(400).send({
        code: "validation_error",
        message: "Préfixe, largeur du numéro de titre et clé de contrôle doivent totaliser 13 chiffres (ISBN-13).",
      });
    }
    const pool = await prisma.isbnPool.create({
      data: {
        prefix: body.prefix,
        digitWidth: body.digit_width,
        rangeStart: body.range_start,
        rangeEnd: body.range_end,
        nextValue: body.range_start,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "isbn_pool",
      entityId: pool.id,
      newValues: body,
      ipAddress: request.ip,
    });
    return reply.code(201).send(pool);
  });

  fastify.get("/api/v1/manuscripts/:id/isbn", { preHandler: requirePermission("isbn", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const isbns = await prisma.isbn.findMany({ where: { manuscriptId: id }, orderBy: { createdAt: "asc" } });
    return reply.send(isbns);
  });

  // Référentiel transverse (hors spécification API v1, cf. docs/JOURNAL_TECHNIQUE.md) :
  // nécessaire aux écrans Stock et Commercial pour choisir un ouvrage par ISBN
  // sans naviguer manuscrit par manuscrit.
  fastify.get("/api/v1/isbns", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { format?: IsbnFormat };
    const isbns = await prisma.isbn.findMany({
      where: query.format ? { format: query.format } : {},
      include: {
        manuscript: { select: { title: true } },
        // Prix courant (dernier tarif) : permet de pré-remplir le prix unitaire
        // au moment de la sélection d'un ouvrage dans une commande à facturer.
        priceList: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { price: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(isbns.map((i) => ({ ...i, price_ht: i.priceList[0] ? Number(i.priceList[0].price) : null })));
  });

  // Attribution (Ch. 13 §13.3) : conditions vérifiées (contrat actif), ISBN
  // suivant disponible dans la tranche, clé de contrôle calculée, propagation
  // via la relation manuscriptId (page de copyright Ch. 11, code-barres Ch. 12).
  fastify.post(
    "/api/v1/manuscripts/:id/isbn",
    { preHandler: requirePermission("isbn", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = isbnAttributionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const activeContract = await prisma.contract.findFirst({
        where: { manuscriptId: id, status: ContractStatus.active },
      });
      if (!activeContract) {
        return reply.code(409).send({
          code: "contract_required",
          message: "Aucun contrat actif : l'ISBN ne peut pas être attribué (Ch. 13 §13.3).",
        });
      }

      const existingForFormat = await prisma.isbn.findFirst({
        where: { manuscriptId: id, format: parsed.data.format },
      });
      if (existingForFormat) {
        return reply.code(409).send({
          code: "isbn_already_assigned",
          message: `Un ISBN est déjà attribué pour le format « ${parsed.data.format} ».`,
        });
      }

      const pool = parsed.data.pool_id
        ? await prisma.isbnPool.findUnique({ where: { id: parsed.data.pool_id } })
        : await prisma.isbnPool.findFirst({ orderBy: { receivedAt: "asc" } });
      if (!pool || poolAvailableCount(pool) <= 0) {
        return reply.code(409).send({ code: "isbn_stock_exhausted", message: "Aucun ISBN disponible dans le stock." });
      }

      const titleNumber = String(pool.nextValue).padStart(pool.digitWidth, "0");
      const first12 = `${pool.prefix}${titleNumber}`;
      const checkDigit = computeEan13CheckDigit(first12);
      const isbn13 = `${first12}${checkDigit}`;

      const [created] = await prisma.$transaction([
        prisma.isbn.create({
          data: {
            isbn13,
            poolId: pool.id,
            manuscriptId: id,
            format: parsed.data.format,
            status: "assigned",
            assignedAt: new Date(),
            assignedBy: request.user!.id,
          },
        }),
        prisma.isbnPool.update({ where: { id: pool.id }, data: { nextValue: pool.nextValue + 1 } }),
      ]);

      const remaining = poolAvailableCount({ ...pool, nextValue: pool.nextValue + 1 });
      const threshold = await isbnStockAlertThreshold();
      if (remaining < threshold) {
        await prisma.notification.create({
          data: {
            userId: request.user!.id,
            type: "alerte_stock",
            priority: "high",
            title: "Stock d'ISBN bas",
            body: `Il reste ${remaining} ISBN disponible(s) dans la tranche « ${pool.prefix} », sous le seuil de ${threshold}.`,
            entityType: "isbn_pool",
            entityId: pool.id,
          },
        });
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "isbn",
        entityId: created.id,
        newValues: { manuscriptId: id, isbn13, format: parsed.data.format },
        ipAddress: request.ip,
      });

      return reply.code(201).send(created);
    },
  );

  fastify.get("/api/v1/isbn/:id/barcode", { preHandler: requirePermission("isbn", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const isbn = await prisma.isbn.findUnique({ where: { id } });
    if (!isbn) {
      return reply.code(404).send({ code: "not_found", message: "ISBN introuvable." });
    }
    const svg = isbn13ToBarcodeSvg(isbn.isbn13);
    reply.type("image/svg+xml");
    return reply.send(svg);
  });

  // Dépôt légal (Ch. 13 §13.5) — plusieurs fiches possibles (un pays de
  // référence par fiche), réglementation non tranchée, cf. JOURNAL_TECHNIQUE.md.
  fastify.get(
    "/api/v1/manuscripts/:id/legal-deposits",
    { preHandler: requirePermission("isbn", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deposits = await prisma.legalDeposit.findMany({ where: { manuscriptId: id }, orderBy: { createdAt: "asc" } });
      return reply.send(deposits);
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/legal-deposits",
    { preHandler: requirePermission("isbn", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = legalDepositSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }
      const deposit = await prisma.legalDeposit.create({
        data: {
          manuscriptId: id,
          country: parsed.data.country,
          depository: parsed.data.depository,
          copiesRequired: parsed.data.copies_required,
          dueDate: parsed.data.due_date ? new Date(parsed.data.due_date) : undefined,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "legal_deposit",
        entityId: deposit.id,
        newValues: parsed.data,
        ipAddress: request.ip,
      });
      return reply.code(201).send(deposit);
    },
  );

  fastify.patch(
    "/api/v1/legal-deposits/:id",
    { preHandler: requirePermission("isbn", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = legalDepositUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const existing = await prisma.legalDeposit.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ code: "not_found", message: "Fiche de dépôt légal introuvable." });
      }
      const body = parsed.data;
      const updated = await prisma.legalDeposit.update({
        where: { id },
        data: {
          status: body.status,
          depositedAt: body.deposited_at ? new Date(body.deposited_at) : undefined,
          depositNumber: body.deposit_number,
          receiptDocumentId: body.receipt_document_id,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "legal_deposit",
        entityId: id,
        newValues: body,
        ipAddress: request.ip,
      });
      return reply.send(updated);
    },
  );

  // Fiche de métadonnées (Ch. 13 §13.6) : source unique, versionnée ; toute
  // modification signale les partenaires déjà notifiés (§13.8) via needsResend.
  fastify.get("/api/v1/manuscripts/:id/metadata", { preHandler: requirePermission("isbn", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const metadata = await prisma.workMetadata.findUnique({ where: { manuscriptId: id } });
    return reply.send(metadata);
  });

  fastify.patch(
    "/api/v1/manuscripts/:id/metadata",
    { preHandler: requirePermission("isbn", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = workMetadataSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const existing = await prisma.workMetadata.findUnique({ where: { manuscriptId: id } });
      const body = parsed.data;
      const data = {
        weightGrams: body.weight_grams,
        summary: body.summary,
        authorBio: body.author_bio,
        publicTarget: body.public_target,
        ageRange: body.age_range,
        themaCodes: body.thema_codes,
        priceByCountry: body.price_by_country ? JSON.parse(JSON.stringify(body.price_by_country)) : undefined,
        updatedBy: request.user!.id,
      };

      const updated = existing
        ? await prisma.workMetadata.update({ where: { manuscriptId: id }, data: { ...data, version: existing.version + 1 } })
        : await prisma.workMetadata.create({ data: { manuscriptId: id, ...data } });

      if (existing) {
        // Ch. 13 §13.8 : toute modification signale les partenaires déjà notifiés.
        await prisma.metadataExport.updateMany({ where: { manuscriptId: id }, data: { needsResend: true } });
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "work_metadata",
        entityId: updated.id,
        newValues: JSON.parse(JSON.stringify(body)),
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  fastify.get(
    "/api/v1/manuscripts/:id/metadata-exports",
    { preHandler: requirePermission("isbn", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const exports = await prisma.metadataExport.findMany({ where: { manuscriptId: id }, orderBy: { sentAt: "desc" } });
      return reply.send(exports);
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/metadata-exports",
    { preHandler: requirePermission("isbn", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = metadataExportSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const metadata = await prisma.workMetadata.findUnique({ where: { manuscriptId: id } });
      if (!metadata) {
        return reply.code(409).send({ code: "metadata_missing", message: "Fiche de métadonnées introuvable ou incomplète." });
      }
      const created = await prisma.metadataExport.create({
        data: {
          manuscriptId: id,
          partnerId: parsed.data.partner_id,
          format: parsed.data.format,
          metadataVersion: metadata.version,
          needsResend: false,
        },
      });
      return reply.code(201).send(created);
    },
  );

  // Contrôle de complétude bloquant avant le BAT (Ch. 13 §13.9).
  fastify.get(
    "/api/v1/manuscripts/:id/isbn-completeness",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await computeIsbnCompleteness(id);
      return reply.send(result);
    },
  );
}

// Réutilisé par le module BAT (Ch. 14 §14.2 : contrôle de complétude préalable).
