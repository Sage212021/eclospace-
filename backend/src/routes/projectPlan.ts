import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProjectActivityPriority, ProjectActivityStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { storeFile, readStoredFile } from "../lib/storage.js";

// Document officiel du planning : le planning est SAISI dans Eclospace, puis
// « déposé » sous la forme de son PDF officiel — conservé comme document
// versionné du dossier (nom, format, date, déposant), consultable et
// téléchargeable ultérieurement sans avoir à le régénérer.
const PLAN_DOC_TITLE = "Planning du projet (PDF officiel)";

// Planification du projet (étape PLANIFICATION) : le planning est SAISI dans
// Eclospace et LIÉ au manuscrit (plus de fichier externe à déposer). Un plan par
// manuscrit ; il est remplacé/mis à jour d'un bloc, et `version` s'incrémente à
// chaque enregistrement (traçabilité). L'aperçu et le PDF officiel sont générés
// côté client à partir de ces données.

const optionalDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), { message: "Date invalide." });

const activitySchema = z.object({
  label: z.string().trim().min(1).max(300),
  responsible: z.string().trim().max(200).optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  start_date: optionalDate,
  end_date: optionalDate,
  priority: z.nativeEnum(ProjectActivityPriority).default("normale"),
  status: z.nativeEnum(ProjectActivityStatus).default("a_faire"),
  dependencies: z.string().trim().max(1000).optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
});

const planSchema = z.object({
  manager_name: z.string().trim().max(200).optional().nullable(),
  start_date: optionalDate,
  end_date: optionalDate,
  objectives: z.string().trim().max(4000).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  activities: z.array(activitySchema).max(200).default([]),
});

function view(plan: {
  id: string;
  managerName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  objectives: string | null;
  notes: string | null;
  version: number;
  updatedAt: Date;
  pdfGeneratedAt: Date | null;
  activities: {
    id: string;
    label: string;
    responsible: string | null;
    location: string | null;
    startDate: Date | null;
    endDate: Date | null;
    priority: ProjectActivityPriority;
    status: ProjectActivityStatus;
    dependencies: string | null;
    observations: string | null;
    displayOrder: number;
  }[];
}) {
  return {
    id: plan.id,
    manager_name: plan.managerName,
    start_date: plan.startDate?.toISOString() ?? null,
    end_date: plan.endDate?.toISOString() ?? null,
    objectives: plan.objectives,
    notes: plan.notes,
    version: plan.version,
    updated_at: plan.updatedAt.toISOString(),
    pdf_generated_at: plan.pdfGeneratedAt?.toISOString() ?? null,
    activities: [...plan.activities]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((a) => ({
        id: a.id,
        label: a.label,
        responsible: a.responsible,
        location: a.location,
        start_date: a.startDate?.toISOString() ?? null,
        end_date: a.endDate?.toISOString() ?? null,
        priority: a.priority,
        status: a.status,
        dependencies: a.dependencies,
        observations: a.observations,
      })),
  };
}

export default async function projectPlanRoutes(fastify: FastifyInstance) {
  // Lecture du planning d'un manuscrit (null s'il n'y en a pas encore).
  fastify.get(
    "/api/v1/manuscripts/:id/project-plan",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const plan = await prisma.projectPlan.findFirst({ where: { manuscriptId: id, deletedAt: null }, include: { activities: true } });
      return reply.send(plan ? view(plan) : null);
    },
  );

  // Enregistrement (création ou mise à jour) du planning : les activités sont
  // remplacées en bloc dans une transaction ; la version s'incrémente.
  fastify.put(
    "/api/v1/manuscripts/:id/project-plan",
    { preHandler: requirePermission("manuscripts", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = planSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: { select: { code: true } } } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      // Le planning est modifiable à TOUTE étape (demande opérateur 01/10) SAUF
      // une fois l'ouvrage arrivé à l'archivage : le dossier y est figé.
      if (manuscript.status.code === "ARCHIVAGE") {
        return reply.code(409).send({ code: "manuscript_archived", message: "L'ouvrage est à l'archivage : le planning du projet n'est plus modifiable." });
      }
      const d = parsed.data;

      const saved = await prisma.$transaction(async (tx) => {
        const existing = await tx.projectPlan.findFirst({ where: { manuscriptId: id }, select: { id: true, version: true, deletedAt: true } });
        const planData = {
          managerName: d.manager_name ?? null,
          startDate: d.start_date,
          endDate: d.end_date,
          objectives: d.objectives ?? null,
          notes: d.notes ?? null,
          updatedBy: request.user!.id,
        };
        let planId: string;
        if (existing) {
          await tx.projectPlan.update({
            where: { id: existing.id },
            data: { ...planData, version: existing.version + 1, deletedAt: null },
          });
          await tx.projectPlanActivity.deleteMany({ where: { planId: existing.id } });
          planId = existing.id;
        } else {
          const created = await tx.projectPlan.create({
            data: { ...planData, manuscriptId: id, createdBy: request.user!.id },
          });
          planId = created.id;
        }
        if (d.activities.length > 0) {
          await tx.projectPlanActivity.createMany({
            data: d.activities.map((a, i) => ({
              planId,
              label: a.label,
              responsible: a.responsible ?? null,
              location: a.location ?? null,
              startDate: a.start_date,
              endDate: a.end_date,
              priority: a.priority,
              status: a.status,
              dependencies: a.dependencies ?? null,
              observations: a.observations ?? null,
              displayOrder: i,
            })),
          });
        }
        return tx.projectPlan.findUniqueOrThrow({ where: { id: planId }, include: { activities: true } });
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "project_plan",
        entityId: saved.id,
        newValues: { manuscriptId: id, activities: d.activities.length, version: saved.version },
        ipAddress: request.ip,
      });
      return reply.send(view(saved));
    },
  );

  // Métadonnées du document officiel conservé (pour la carte fichier :
  // nom, format, taille, date de dépôt, déposant, n° de version).
  fastify.get(
    "/api/v1/manuscripts/:id/project-plan/document",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const doc = await prisma.document.findFirst({
        where: { entityType: "manuscript", entityId: id, category: "piece_etape", title: PLAN_DOC_TITLE, deletedAt: null },
        select: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      const v = doc?.versions[0];
      if (!v) return reply.send({ has_file: false });
      const uploader = v.uploadedBy ? await prisma.user.findUnique({ where: { id: v.uploadedBy }, select: { username: true } }) : null;
      return reply.send({
        has_file: true,
        version_id: v.id,
        version_number: v.versionNumber,
        file_size: v.fileSize,
        mime_type: v.mimeType,
        deposited_at: v.uploadedAt.toISOString(),
        deposited_by: uploader?.username ?? null,
      });
    },
  );

  // Consultation / téléchargement du PDF conservé (inline par défaut pour
  // l'aperçu ; en pièce jointe avec ?download=1 pour l'enregistrement local).
  fastify.get(
    "/api/v1/manuscripts/:id/project-plan/document/download",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { download } = request.query as { download?: string };
      const doc = await prisma.document.findFirst({
        where: { entityType: "manuscript", entityId: id, category: "piece_etape", title: PLAN_DOC_TITLE, deletedAt: null },
        select: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      const v = doc?.versions[0];
      if (!v) return reply.code(404).send({ code: "not_found", message: "Aucun planning conservé pour cet ouvrage." });
      const buffer = await readStoredFile(v.filePath);
      reply.header("content-type", v.mimeType || "application/pdf");
      reply.header("content-disposition", `${download ? "attachment" : "inline"}; filename="planning-projet-v${v.versionNumber}.pdf"`);
      return reply.send(buffer);
    },
  );

  // « Déposer le planning » : le navigateur génère le PDF officiel du planning
  // (à partir des données saisies) et le CONSERVE ici comme document versionné.
  // C'est ce dépôt qui autorise le passage à l'étape suivante (garde-fou
  // `plan_not_generated`) et qui reste consultable/téléchargeable ensuite.
  fastify.post(
    "/api/v1/manuscripts/:id/project-plan/document",
    { preHandler: requirePermission("manuscripts", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const plan = await prisma.projectPlan.findFirst({ where: { manuscriptId: id, deletedAt: null }, select: { id: true } });
      if (!plan) return reply.code(400).send({ code: "plan_missing", message: "Enregistrez d'abord le planning avant de conserver son PDF." });
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
      const buffer = await file.toBuffer();
      if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
      if (file.mimetype !== "application/pdf") return reply.code(400).send({ code: "invalid_type", message: "Le document du planning doit être un PDF." });
      const stored = await storeFile(buffer, `planning-projet-${id}-${file.filename || "planning.pdf"}`);

      let doc = await prisma.document.findFirst({
        where: { entityType: "manuscript", entityId: id, category: "piece_etape", title: PLAN_DOC_TITLE, deletedAt: null },
      });
      if (!doc) {
        doc = await prisma.document.create({
          data: { entityType: "manuscript", entityId: id, category: "piece_etape", confidentiality: "interne", title: PLAN_DOC_TITLE, createdBy: request.user!.id, updatedBy: request.user!.id },
        });
      }
      const last = await prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: "desc" } });
      const version = await prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          filePath: stored.filePath,
          fileSize: stored.fileSize,
          mimeType: "application/pdf",
          sha256Hash: stored.sha256Hash,
          changeSummary: "Planning du projet conservé (PDF officiel)",
          uploadedBy: request.user!.id,
        },
      });
      const now = new Date();
      await prisma.projectPlan.update({ where: { id: plan.id }, data: { pdfGeneratedAt: now, pdfGeneratedBy: request.user!.id } });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "document_version",
        entityId: version.id,
        newValues: { project_plan_document: true, versionNumber: version.versionNumber },
        ipAddress: request.ip,
      });
      return reply.code(201).send({ has_file: true, version_number: version.versionNumber, deposited_at: now.toISOString() });
    },
  );
}
