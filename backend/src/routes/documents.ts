import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DocumentCategory, Confidentiality } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { storeFile, readStoredFile } from "../lib/storage.js";

const createDocumentSchema = z.object({
  entity_type: z.string().min(1),
  entity_id: z.string().uuid(),
  category: z.nativeEnum(DocumentCategory),
  title: z.string().min(1),
  confidentiality: z.nativeEnum(Confidentiality).default("interne"),
});

const listDocumentsQuerySchema = z.object({
  entity_type: z.string().min(1),
  entity_id: z.string().uuid(),
});

// GED transverse (spécification API §2.3, modèle §3.5) : le dépôt d'une
// version ne remplace jamais la précédente ; le hash est calculé côté serveur.
export default async function documentRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/documents", { preHandler: requirePermission("documents", "consultation") }, async (request, reply) => {
    const parsed = listDocumentsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const documents = await prisma.document.findMany({
      where: { entityType: parsed.data.entity_type, entityId: parsed.data.entity_id, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(documents);
  });

  fastify.post("/api/v1/documents", { preHandler: requirePermission("documents", "saisie") }, async (request, reply) => {
    const parsed = createDocumentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }

    const document = await prisma.document.create({
      data: {
        entityType: parsed.data.entity_type,
        entityId: parsed.data.entity_id,
        category: parsed.data.category,
        title: parsed.data.title,
        confidentiality: parsed.data.confidentiality,
        createdBy: request.user!.id,
        updatedBy: request.user!.id,
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "document",
      entityId: document.id,
      newValues: parsed.data,
      ipAddress: request.ip,
    });

    return reply.code(201).send(document);
  });

  fastify.post(
    "/api/v1/documents/:id/versions",
    { preHandler: requirePermission("documents", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const document = await prisma.document.findUnique({ where: { id, deletedAt: null } });
      if (!document) {
        return reply.code(404).send({ code: "not_found", message: "Document introuvable." });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
      }
      const changeSummary = (file.fields.change_summary as { value?: string } | undefined)?.value ?? null;
      const buffer = await file.toBuffer();
      const stored = await storeFile(buffer, file.filename);

      const lastVersion = await prisma.documentVersion.findFirst({
        where: { documentId: id },
        orderBy: { versionNumber: "desc" },
      });

      const version = await prisma.documentVersion.create({
        data: {
          documentId: id,
          versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
          filePath: stored.filePath,
          fileSize: stored.fileSize,
          mimeType: file.mimetype,
          sha256Hash: stored.sha256Hash,
          changeSummary,
          uploadedBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "document_version",
        entityId: version.id,
        newValues: { documentId: id, versionNumber: version.versionNumber, sha256Hash: stored.sha256Hash },
        ipAddress: request.ip,
      });

      return reply.code(201).send(version);
    },
  );

  fastify.get(
    "/api/v1/documents/:id/versions",
    { preHandler: requirePermission("documents", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const versions = await prisma.documentVersion.findMany({
        where: { documentId: id },
        orderBy: { versionNumber: "desc" },
      });
      return reply.send(versions);
    },
  );

  fastify.get(
    "/api/v1/document-versions/:id/download",
    { preHandler: requirePermission("documents", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const version = await prisma.documentVersion.findUnique({ where: { id } });
      if (!version) {
        return reply.code(404).send({ code: "not_found", message: "Version introuvable." });
      }
      const buffer = await readStoredFile(version.filePath);
      reply.header("content-type", version.mimeType);
      return reply.send(buffer);
    },
  );
}
