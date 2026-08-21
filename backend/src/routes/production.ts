import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ImageAssetType, RightsOrigin } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { canCorrectDeposit } from "../lib/stepDocuments.js";

// Seuil de résolution minimal pour l'impression (Ch. 11 §11.7), paramétrable
// via settings — valeur de départ conforme au texte ("300 dpi").
async function minResolutionDpi(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: "min_resolution_dpi" } });
  return (setting?.value as number | undefined) ?? 300;
}

const productionSpecsSchema = z.object({
  trim_format: z.string().optional(),
  final_pages: z.number().int().positive().optional(),
  paper_interior: z.string().optional(),
  paper_interior_gsm: z.number().int().positive().optional(),
  paper_cover: z.string().optional(),
  binding: z.string().optional(),
  lamination: z.string().optional(),
});

// Approximation documentée (docs/JOURNAL_TECHNIQUE.md) : le cahier des
// charges exige le calcul (Ch. 12 §12.3) sans fixer de formule — celle-ci
// est à confirmer avec les imprimeurs partenaires.
function computeSpineWidthMm(finalPages: number, paperInteriorGsm: number): number {
  const bulkFactor = 0.0012; // mm d'épaisseur par gramme/m² et par page recto
  return Math.round(finalPages * paperInteriorGsm * bulkFactor * 100) / 100;
}

const imageAssetSchema = z.object({
  type: z.nativeEnum(ImageAssetType),
  placement: z.string().optional(),
  resolution_dpi: z.number().int().positive().optional(),
  color_mode: z.string().optional(),
  rights_origin: z.nativeEnum(RightsOrigin).optional(),
  rights_license: z.string().optional(),
  rights_credit: z.string().optional(),
  document_version_id: z.string().uuid().optional(),
});

const layoutTemplateSchema = z.object({
  name: z.string().min(1),
  collection_id: z.string().uuid().optional(),
  format: z.string().min(1),
  specs: z.record(z.unknown()).default({}),
});

const graphicCharterSchema = z.object({
  scope: z.enum(["maison", "collection"]),
  collection_id: z.string().uuid().optional(),
  description: z.string().optional(),
});

// Maquette (Ch. 11) et Infographie (Ch. 12) : fiche technique de fabrication,
// visuels avec contrôle technique et droits iconographiques, bibliothèques
// de gabarits et de chartes graphiques.
export default async function productionRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/v1/manuscripts/:id/production-specs",
    { preHandler: requirePermission("production", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const specs = await prisma.productionSpecs.findUnique({ where: { manuscriptId: id } });
      return reply.send(specs);
    },
  );

  fastify.patch(
    "/api/v1/manuscripts/:id/production-specs",
    { preHandler: requirePermission("production", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = productionSpecsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const existing = await prisma.productionSpecs.findUnique({ where: { manuscriptId: id } });
      const body = parsed.data;
      const finalPages = body.final_pages ?? existing?.finalPages ?? undefined;
      const paperGsm = body.paper_interior_gsm ?? existing?.paperInteriorGsm ?? undefined;

      // Ch. 12 §12.3 : toute modification du nombre de pages ou du papier
      // déclenche une alerte de recalcul du dos.
      const pagesOrPaperChanged =
        (body.final_pages !== undefined && body.final_pages !== existing?.finalPages) ||
        (body.paper_interior_gsm !== undefined && body.paper_interior_gsm !== existing?.paperInteriorGsm);

      const spineWidthMm = finalPages && paperGsm ? computeSpineWidthMm(finalPages, paperGsm) : existing?.spineWidthMm ?? null;

      const updated = await prisma.productionSpecs.upsert({
        where: { manuscriptId: id },
        update: {
          trimFormat: body.trim_format,
          finalPages: body.final_pages,
          paperInterior: body.paper_interior,
          paperInteriorGsm: body.paper_interior_gsm,
          paperCover: body.paper_cover,
          binding: body.binding,
          lamination: body.lamination,
          spineWidthMm,
          spineNeedsRecalc: pagesOrPaperChanged,
          updatedBy: request.user!.id,
        },
        create: {
          manuscriptId: id,
          trimFormat: body.trim_format,
          finalPages: body.final_pages,
          paperInterior: body.paper_interior,
          paperInteriorGsm: body.paper_interior_gsm,
          paperCover: body.paper_cover,
          binding: body.binding,
          lamination: body.lamination,
          spineWidthMm,
          spineNeedsRecalc: pagesOrPaperChanged,
          updatedBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "production_specs",
        entityId: id,
        newValues: { ...body, spineWidthMm },
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/image-assets",
    { preHandler: requirePermission("production", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = imageAssetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const body = parsed.data;
      const threshold = await minResolutionDpi();
      // Contrôle technique automatique au dépôt (Ch. 11 §11.7, Ch. 12 §12.5).
      const technicalOk = (body.resolution_dpi ?? 0) >= threshold && body.color_mode?.toUpperCase() === "CMJN";

      const asset = await prisma.imageAsset.create({
        data: {
          manuscriptId: id,
          type: body.type,
          placement: body.placement,
          resolutionDpi: body.resolution_dpi,
          colorMode: body.color_mode,
          technicalOk,
          rightsOrigin: body.rights_origin,
          rightsLicense: body.rights_license,
          rightsCredit: body.rights_credit,
          documentVersionId: body.document_version_id,
          createdBy: request.user!.id,
        },
      });

      if (!technicalOk) {
        await prisma.notification.create({
          data: {
            userId: request.user!.id,
            type: "autre",
            priority: "high",
            title: "Visuel non conforme",
            body: `Le visuel « ${body.type} » ne respecte pas les exigences techniques (résolution ≥ ${threshold} dpi, mode CMJN).`,
            entityType: "manuscript",
            entityId: id,
          },
        });
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "image_asset",
        entityId: asset.id,
        newValues: { manuscriptId: id, type: body.type, technicalOk },
        ipAddress: request.ip,
      });

      return reply.code(201).send(asset);
    },
  );

  fastify.get(
    "/api/v1/manuscripts/:id/image-assets",
    { preHandler: requirePermission("production", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const assets = await prisma.imageAsset.findMany({ where: { manuscriptId: id, deletedAt: null }, orderBy: { createdAt: "desc" } });
      return reply.send(assets.map((a) => ({ ...a, can_correct: canCorrectDeposit(request, a.createdBy) })));
    },
  );

  // Retirer un visuel (couverture, illustration…) déposé PAR ERREUR par
  // l'infographe. Suppression LOGIQUE (Modèle §13) ; on peut aussitôt en
  // redéposer un. Réservé à l'auteur du dépôt et à la direction.
  fastify.delete(
    "/api/v1/manuscripts/:id/image-assets/:assetId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, assetId } = request.params as { id: string; assetId: string };
      const asset = await prisma.imageAsset.findFirst({ where: { id: assetId, manuscriptId: id, deletedAt: null } });
      if (!asset) return reply.code(404).send({ code: "not_found", message: "Visuel introuvable." });
      if (!canCorrectDeposit(request, asset.createdBy)) {
        return reply.code(403).send({ code: "forbidden", message: "Seuls l'auteur du dépôt et la direction peuvent retirer ce visuel." });
      }
      await prisma.imageAsset.update({ where: { id: assetId }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "image_asset", entityId: assetId, newValues: { removed: true, type: asset.type }, ipAddress: request.ip });
      return reply.send({ removed: true });
    },
  );

  fastify.get("/api/v1/layout-templates", { preHandler: requireAuth }, async (request, reply) => {
    const { collection } = request.query as { collection?: string };
    const templates = await prisma.layoutTemplate.findMany({
      where: { deletedAt: null, ...(collection ? { collectionId: collection } : {}) },
      orderBy: { name: "asc" },
    });
    return reply.send(templates);
  });

  fastify.post(
    "/api/v1/layout-templates",
    { preHandler: requirePermission("production", "administration") },
    async (request, reply) => {
      const parsed = layoutTemplateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const template = await prisma.layoutTemplate.create({
        data: {
          name: parsed.data.name,
          collectionId: parsed.data.collection_id,
          format: parsed.data.format,
          specs: JSON.parse(JSON.stringify(parsed.data.specs)),
        },
      });
      return reply.code(201).send(template);
    },
  );

  fastify.get("/api/v1/graphic-charters", { preHandler: requireAuth }, async (request, reply) => {
    const { collection } = request.query as { collection?: string };
    const charters = await prisma.graphicCharter.findMany({
      where: { deletedAt: null, ...(collection ? { collectionId: collection } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(charters);
  });

  fastify.post(
    "/api/v1/graphic-charters",
    { preHandler: requirePermission("production", "administration") },
    async (request, reply) => {
      const parsed = graphicCharterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const charter = await prisma.graphicCharter.create({
        data: { scope: parsed.data.scope, collectionId: parsed.data.collection_id, description: parsed.data.description },
      });
      return reply.code(201).send(charter);
    },
  );
}
