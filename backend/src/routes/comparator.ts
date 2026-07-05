import type { FastifyInstance } from "fastify";
import { z } from "zod";
import mammoth from "mammoth";
import { diffLines } from "diff";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { readStoredFile, storeFile } from "../lib/storage.js";

const compareSchema = z.object({
  left_id: z.string().uuid(),
  right_id: z.string().uuid(),
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function extractText(filePath: string, mimeType: string): Promise<string> {
  if (mimeType !== DOCX_MIME) {
    throw new Error(`UNSUPPORTED_FORMAT:${mimeType}`);
  }
  const buffer = await readStoredFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Comparateur de versions (Ch. 10 §10.5) : risque technique identifié par le
// plan de développement. Portée volontairement limitée aux fichiers .docx en
// v1 (repli prévu par le plan) ; le rapport PDF n'est pas encore généré, seul
// le rapport structuré (JSON), archivé au dossier, est produit pour l'instant.
export default async function comparatorRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/v1/document-versions/compare",
    { preHandler: requirePermission("documents", "consultation") },
    async (request, reply) => {
      const parsed = compareSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const [left, right] = await Promise.all([
        prisma.documentVersion.findUnique({ where: { id: parsed.data.left_id }, include: { document: true } }),
        prisma.documentVersion.findUnique({ where: { id: parsed.data.right_id }, include: { document: true } }),
      ]);
      if (!left || !right) {
        return reply.code(404).send({ code: "not_found", message: "Version introuvable." });
      }
      if (left.documentId !== right.documentId) {
        return reply.code(409).send({ code: "different_documents", message: "Les deux versions doivent appartenir au même document." });
      }

      let leftText: string;
      let rightText: string;
      try {
        [leftText, rightText] = await Promise.all([
          extractText(left.filePath, left.mimeType),
          extractText(right.filePath, right.mimeType),
        ]);
      } catch (error) {
        const format = error instanceof Error ? error.message.split(":")[1] : "inconnu";
        return reply.code(422).send({
          code: "unsupported_format",
          message: `Comparaison prise en charge uniquement pour les fichiers .docx à ce stade (Ch. 10 §10.5). Format reçu : ${format}.`,
        });
      }

      const parts = diffLines(leftText, rightText);
      let additions = 0;
      let deletions = 0;
      const changes = parts.map((part) => {
        const lineCount = part.value.split("\n").filter(Boolean).length;
        if (part.added) additions += lineCount;
        if (part.removed) deletions += lineCount;
        return { type: part.added ? "added" : part.removed ? "removed" : "unchanged", value: part.value };
      });

      const report = {
        left_version: left.versionNumber,
        right_version: right.versionNumber,
        additions,
        deletions,
        modifications: Math.min(additions, deletions),
        changes,
      };

      // Archivé au dossier si le document comparé est bien rattaché à un manuscrit (Ch. 10 §10.5).
      if (left.document.entityType === "manuscript") {
        const reportDocument = await prisma.document.create({
          data: {
            entityType: "manuscript",
            entityId: left.document.entityId,
            category: "rapport_comparaison",
            title: `Comparaison v${left.versionNumber} ↔ v${right.versionNumber} — ${left.document.title}`,
            createdBy: request.user!.id,
            updatedBy: request.user!.id,
          },
        });
        const stored = await storeFile(Buffer.from(JSON.stringify(report, null, 2)), `comparaison-v${left.versionNumber}-v${right.versionNumber}.json`);
        await prisma.documentVersion.create({
          data: {
            documentId: reportDocument.id,
            versionNumber: 1,
            filePath: stored.filePath,
            fileSize: stored.fileSize,
            mimeType: "application/json",
            sha256Hash: stored.sha256Hash,
            uploadedBy: request.user!.id,
          },
        });
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "export",
        entityType: "document_version",
        entityId: left.id,
        newValues: { comparedWith: right.id, additions, deletions },
        ipAddress: request.ip,
      });

      return reply.send(report);
    },
  );
}
