import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AnomalySeverity, BatStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyRole } from "../lib/notify.js";
import { computeIsbnCompleteness } from "../lib/isbnCompleteness.js";
import { checkMaquetteInfographieConvergence } from "../lib/productionConvergence.js";
import { storeFile, readStoredFile } from "../lib/storage.js";

// Ch. 14 §14.3 : liste de contrôle paramétrable, valeurs de départ conformes
// au texte — la direction pourra en ajouter par collection (non implémenté :
// même mécanisme générique Checklist/ChecklistItem, cf. docs/JOURNAL_TECHNIQUE.md).
const DEFAULT_BAT_CHECKLIST_ITEMS: { label: string; isBlocking: boolean }[] = [
  { label: "Conformité de la mise en page au gabarit", isBlocking: true },
  { label: "Pagination et table des matières exactes", isBlocking: true },
  { label: "Mentions légales exactes (ISBN, dépôt légal, copyright, achevé d'imprimer)", isBlocking: true },
  { label: "Qualité des images (résolution, colorimétrie)", isBlocking: true },
  { label: "Marges, fonds perdus, traits de coupe", isBlocking: true },
  { label: "Orthographe du titre et du nom de l'auteur en couverture", isBlocking: true },
  { label: "Épaisseur du dos cohérente avec la pagination et le papier", isBlocking: true },
  { label: "Code-barres scannable et conforme à l'ISBN", isBlocking: true },
  { label: "Prix affiché conforme à la fiche commerciale", isBlocking: false },
  { label: "Couleurs et pelliculage conformes à la charte", isBlocking: false },
  { label: "Correspondance intérieur/couverture (titre, auteur, collection)", isBlocking: true },
  { label: "Fiche technique complète pour l'imprimeur", isBlocking: true },
];

async function checkBatConvergence(manuscriptId: string): Promise<string[]> {
  const isbnCompleteness = await computeIsbnCompleteness(manuscriptId);
  const missing = await checkMaquetteInfographieConvergence(manuscriptId);
  if (!isbnCompleteness.complete) missing.unshift("isbn_metadonnees_incomplet");
  // VERROU couverture (Lot 3, branche couverture) : le BAT — épreuve finale
  // combinant intérieur et couverture — ne s'ouvre pas tant que des corrections
  // de COUVERTURE retenues (acceptées/modifiées) ne sont pas intégrées par
  // l'infographe (ou écartées « non applicable » avec motif).
  const coverPending = await prisma.correctionAnomaly.count({
    where: { manuscriptId, status: { in: ["acceptee", "modifiee"] }, integrationStatus: { in: ["a_integrer", "a_revoir"] }, job: { workType: "couverture" } },
  });
  if (coverPending > 0) missing.push("corrections_couverture_non_integrees");
  return missing;
}

const openBatSchema = z.object({
  interior_version_id: z.string().uuid(),
  cover_version_id: z.string().uuid(),
});

const anomalySchema = z.object({
  description: z.string().min(1),
  location: z.string().optional(),
  severity: z.nativeEnum(AnomalySeverity),
  returned_to: z.string().optional(),
});

// Correction des fichiers d'un BAT non signé : au moins l'un des deux doit être fourni.
const updateFilesSchema = z
  .object({
    interior_version_id: z.string().uuid().optional(),
    cover_version_id: z.string().uuid().optional(),
  })
  .refine((d) => !!d.interior_version_id || !!d.cover_version_id, {
    message: "Indiquez le nouveau fichier intérieur et/ou couverture.",
  });

const statusSchema = z.object({ status: z.enum(["corrections_requested", "awaiting_signature"]) });

const signSchema = z.object({ author_approval: z.boolean().optional() });

const cancelSchema = z.object({ justification: z.string().min(1) });

// Ch. 14 : BAT (verrou de sécurité avant impression) et contrôle qualité.
export default async function batRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/manuscripts/:id/bat", { preHandler: requirePermission("bat", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const records = await prisma.batRecord.findMany({
      where: { manuscriptId: id },
      orderBy: { cycleNumber: "desc" },
      include: { anomalies: true, signatures: true, checklist: { include: { items: true } } },
    });
    return reply.send(records);
  });

  fastify.get("/api/v1/bat/:id", { preHandler: requirePermission("bat", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await prisma.batRecord.findUnique({
      where: { id },
      include: { anomalies: true, signatures: true, checklist: { include: { items: true } } },
    });
    if (!record) {
      return reply.code(404).send({ code: "not_found", message: "BAT introuvable." });
    }
    return reply.send(record);
  });

  // Constitution automatique du dossier (Ch. 14 §14.2) : bloquée tant que la
  // convergence amont (ISBN/métadonnées, fiche technique, couverture) n'est pas atteinte.
  fastify.post(
    "/api/v1/manuscripts/:id/bat",
    { preHandler: requirePermission("bat", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = openBatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const missing = await checkBatConvergence(id);
      if (missing.length > 0) {
        return reply.code(409).send({
          code: "bat_convergence_incomplete",
          message: "Le dossier de BAT ne peut pas être ouvert : éléments amont manquants.",
          missing,
        });
      }

      const [interiorVersion, coverVersion] = await Promise.all([
        prisma.documentVersion.findUnique({ where: { id: parsed.data.interior_version_id } }),
        prisma.documentVersion.findUnique({ where: { id: parsed.data.cover_version_id } }),
      ]);
      if (!interiorVersion || !coverVersion) {
        return reply.code(404).send({ code: "not_found", message: "Fichier intérieur ou de couverture introuvable." });
      }

      const lastCycle = await prisma.batRecord.findFirst({ where: { manuscriptId: id }, orderBy: { cycleNumber: "desc" } });
      const specs = await prisma.productionSpecs.findUniqueOrThrow({ where: { manuscriptId: id } });

      const checklist = await prisma.checklist.create({
        data: {
          context: "bat",
          manuscriptId: id,
          items: { create: DEFAULT_BAT_CHECKLIST_ITEMS.map((item) => ({ label: item.label, isBlocking: item.isBlocking })) },
        },
      });

      const record = await prisma.batRecord.create({
        data: {
          manuscriptId: id,
          cycleNumber: (lastCycle?.cycleNumber ?? 0) + 1,
          status: BatStatus.in_control,
          interiorVersionId: interiorVersion.id,
          coverVersionId: coverVersion.id,
          checklistId: checklist.id,
          technicalSheet: {
            trim_format: specs.trimFormat,
            final_pages: specs.finalPages,
            paper_interior: specs.paperInterior,
            paper_cover: specs.paperCover,
            binding: specs.binding,
            lamination: specs.lamination,
          },
        },
        include: { checklist: { include: { items: true } } },
      });

      await notifyRole({
        roleCode: "RESP_QUALITE",
        type: "validation",
        priority: "medium",
        title: "Dossier de BAT prêt au contrôle",
        body: `Le dossier de BAT du manuscrit « ${manuscript.title} » (cycle ${record.cycleNumber}) est complet et prêt au contrôle.`,
        entityType: "bat_record",
        entityId: record.id,
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "bat_record",
        entityId: record.id,
        newValues: { manuscriptId: id, cycleNumber: record.cycleNumber },
        ipAddress: request.ip,
      });

      return reply.code(201).send(record);
    },
  );

  // Nouveau cycle après corrections (Ch. 14 §14.4) : reprend les mêmes fichiers
  // sauf indication contraire, et réinitialise les points non cochés — la
  // limitation stricte "aux points corrigés et de cohérence" reste une
  // simplification documentée (docs/JOURNAL_TECHNIQUE.md).
  fastify.post(
    "/api/v1/manuscripts/:id/bat/reopen",
    { preHandler: requirePermission("bat", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = openBatSchema.partial().safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const current = await prisma.batRecord.findFirst({
        where: { manuscriptId: id },
        orderBy: { cycleNumber: "desc" },
        include: { checklist: { include: { items: true } } },
      });
      if (!current || current.status !== BatStatus.corrections_requested) {
        return reply.code(409).send({
          code: "no_cycle_awaiting_correction",
          message: "Aucun cycle de BAT en attente de correction pour ce manuscrit.",
        });
      }

      const interiorVersionId = parsed.data.interior_version_id ?? current.interiorVersionId!;
      const coverVersionId = parsed.data.cover_version_id ?? current.coverVersionId!;
      const carriedItems = current.checklist!.items.filter((item) => !item.checkedAt && !item.notApplicable);

      const checklist = await prisma.checklist.create({
        data: {
          context: "bat",
          manuscriptId: id,
          items: { create: carriedItems.map((item) => ({ label: item.label, isBlocking: item.isBlocking })) },
        },
      });

      const record = await prisma.batRecord.create({
        data: {
          manuscriptId: id,
          cycleNumber: current.cycleNumber + 1,
          status: BatStatus.in_control,
          interiorVersionId,
          coverVersionId,
          checklistId: checklist.id,
          technicalSheet: current.technicalSheet ?? undefined,
        },
        include: { checklist: { include: { items: true } } },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "bat_record",
        entityId: record.id,
        newValues: { manuscriptId: id, cycleNumber: record.cycleNumber, previousCycleId: current.id },
        ipAddress: request.ip,
      });

      return reply.code(201).send(record);
    },
  );

  // Correction des fichiers du bon à tirer (demande opérateur 16/10 : « on peut
  // avoir sélectionné un fichier par erreur »). Permet de remplacer l'intérieur
  // et/ou la couverture TANT QUE le BAT n'est pas signé (dossier non verrouillé).
  fastify.patch(
    "/api/v1/bat/:id/files",
    { preHandler: requirePermission("bat", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateFilesSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const bat = await prisma.batRecord.findUnique({ where: { id } });
      if (!bat) {
        return reply.code(404).send({ code: "not_found", message: "BAT introuvable." });
      }
      if (bat.status === BatStatus.signed) {
        return reply.code(409).send({ code: "bat_locked", message: "Le BAT est signé : les fichiers sont verrouillés et ne peuvent plus être corrigés." });
      }
      const wantedIds = [parsed.data.interior_version_id, parsed.data.cover_version_id].filter((v): v is string => !!v);
      const found = await prisma.documentVersion.findMany({ where: { id: { in: wantedIds } }, select: { id: true } });
      if (found.length !== wantedIds.length) {
        return reply.code(404).send({ code: "not_found", message: "Fichier intérieur ou de couverture introuvable." });
      }
      const updated = await prisma.batRecord.update({
        where: { id },
        data: {
          interiorVersionId: parsed.data.interior_version_id ?? undefined,
          coverVersionId: parsed.data.cover_version_id ?? undefined,
        },
        include: { anomalies: true, signatures: true, checklist: { include: { items: true } } },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "bat_record",
        entityId: id,
        newValues: {
          interiorVersionId: parsed.data.interior_version_id,
          coverVersionId: parsed.data.cover_version_id,
          reason: "correction_fichiers",
        },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    },
  );

  fastify.patch(
    "/api/v1/checklist-items/:id",
    { preHandler: requirePermission("bat", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ checked: z.boolean().optional(), not_applicable: z.boolean().optional(), observation: z.string().optional() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const item = await prisma.checklistItem.findUnique({
        where: { id },
        include: { checklist: { include: { batRecord: true } } },
      });
      if (!item) {
        return reply.code(404).send({ code: "not_found", message: "Point de contrôle introuvable." });
      }
      if (item.checklist.batRecord?.status === BatStatus.signed) {
        return reply.code(409).send({ code: "bat_locked", message: "Le BAT est signé : les fichiers et le contrôle sont verrouillés." });
      }

      const updated = await prisma.checklistItem.update({
        where: { id },
        data: {
          checkedAt: parsed.data.checked === undefined ? undefined : parsed.data.checked ? new Date() : null,
          checkedBy: parsed.data.checked === undefined ? undefined : parsed.data.checked ? request.user!.id : null,
          notApplicable: parsed.data.not_applicable,
          observation: parsed.data.observation,
        },
      });
      return reply.send(updated);
    },
  );

  fastify.post(
    "/api/v1/bat/:id/anomalies",
    { preHandler: requirePermission("bat", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = anomalySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const bat = await prisma.batRecord.findUnique({ where: { id } });
      if (!bat) {
        return reply.code(404).send({ code: "not_found", message: "BAT introuvable." });
      }
      if (bat.status === BatStatus.signed) {
        return reply.code(409).send({ code: "bat_locked", message: "Le BAT est signé : les fichiers et le contrôle sont verrouillés." });
      }

      const anomaly = await prisma.batAnomaly.create({
        data: {
          batId: id,
          description: parsed.data.description,
          location: parsed.data.location,
          severity: parsed.data.severity,
          returnedTo: parsed.data.returned_to,
        },
      });

      if (parsed.data.severity === "blocking") {
        await notifyRole({
          roleCode: "RESP_QUALITE",
          type: "autre",
          priority: "critical",
          title: "Anomalie bloquante détectée au BAT",
          body: `Anomalie bloquante : ${parsed.data.description}`,
          entityType: "bat_record",
          entityId: id,
        });
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "bat_anomaly",
        entityId: anomaly.id,
        newValues: parsed.data,
        ipAddress: request.ip,
      });

      return reply.code(201).send(anomaly);
    },
  );

  fastify.patch(
    "/api/v1/bat-anomalies/:id/resolve",
    { preHandler: requirePermission("bat", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const updated = await prisma.batAnomaly.update({ where: { id }, data: { resolvedAt: new Date() } });
      return reply.send(updated);
    },
  );

  // Décision de contrôle (Ch. 14 §14.4-14.5) : renvoi en correction ou passage
  // en attente de signature — conditionné à l'état des anomalies/points bloquants.
  fastify.patch(
    "/api/v1/bat/:id/status",
    // Le profil qui PRÉPARE le bon à tirer (bat:saisie) peut le faire passer en
    // signature / le renvoyer en correction (décision opérateur 16/10 : même
    // personne sur tout le bon à tirer ; la vraie autorité reste la
    // contre-validation DG à l'étape du workflow).
    { preHandler: requireAnyPermission([{ module: "bat", action: "saisie" }, { module: "bat", action: "validation" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = statusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const bat = await prisma.batRecord.findUnique({
        where: { id },
        include: { anomalies: true, checklist: { include: { items: true } } },
      });
      if (!bat) {
        return reply.code(404).send({ code: "not_found", message: "BAT introuvable." });
      }
      if (bat.status !== BatStatus.in_control) {
        return reply.code(409).send({ code: "invalid_transition", message: "Seul un BAT en cours de contrôle peut changer de statut." });
      }

      const openMajorOrBlocking = bat.anomalies.filter((a) => !a.resolvedAt && a.severity !== "minor");

      if (parsed.data.status === "corrections_requested") {
        if (openMajorOrBlocking.length === 0) {
          return reply.code(409).send({ code: "no_anomaly", message: "Aucune anomalie majeure ou bloquante ouverte à corriger." });
        }
      } else {
        const uncheckedBlocking = bat.checklist!.items.filter((item) => item.isBlocking && !item.checkedAt && !item.notApplicable);
        if (uncheckedBlocking.length > 0 || openMajorOrBlocking.length > 0) {
          return reply.code(409).send({
            code: "control_incomplete",
            message: "Des points de contrôle bloquants ou des anomalies majeures/bloquantes restent ouverts.",
          });
        }
      }

      const updated = await prisma.batRecord.update({ where: { id }, data: { status: parsed.data.status } });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "bat_record",
        entityId: id,
        newValues: { status: parsed.data.status },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    },
  );

  // Signature électronique (Ch. 14 §14.5) : verrouille les fichiers par leur
  // empreinte combinée et déclenche l'autorisation d'impression (§14.6).
  fastify.post(
    "/api/v1/bat/:id/sign",
    // Signer le bon à tirer = ENREGISTRER la signature de l'auteur (dont le scan
    // est obligatoire). Le profil qui prépare (bat:saisie) peut le faire ; la
    // gouvernance s'exerce à la contre-validation DG du workflow (décision 16/10).
    { preHandler: requireAnyPermission([{ module: "bat", action: "saisie" }, { module: "bat", action: "validation" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = signSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const bat = await prisma.batRecord.findUnique({ where: { id }, include: { manuscript: true } });
      if (!bat) {
        return reply.code(404).send({ code: "not_found", message: "BAT introuvable." });
      }
      if (bat.status !== BatStatus.awaiting_signature) {
        return reply.code(409).send({ code: "invalid_transition", message: "Le BAT n'est pas en attente de signature." });
      }
      // La signature « bon pour impression » exige la PREUVE : le scan du BAT
      // Final signé par l'auteur doit avoir été déposé (demande opérateur 15/10).
      if (!bat.signedScanVersionId) {
        return reply.code(409).send({ code: "signed_scan_required", message: "Déposez d'abord le scan du BAT Final signé par l'auteur avant de signer." });
      }

      const [interiorVersion, coverVersion] = await Promise.all([
        prisma.documentVersion.findUnique({ where: { id: bat.interiorVersionId! } }),
        prisma.documentVersion.findUnique({ where: { id: bat.coverVersionId! } }),
      ]);
      const filesHash = createHash("sha256")
        .update(`${interiorVersion!.sha256Hash}:${coverVersion!.sha256Hash}`)
        .digest("hex");

      const [signature] = await prisma.$transaction([
        prisma.batSignature.create({
          data: {
            batId: id,
            signerId: request.user!.id,
            filesHash,
            authorApproval: parsed.data.author_approval ?? false,
          },
        }),
        prisma.batRecord.update({ where: { id }, data: { status: BatStatus.signed } }),
      ]);

      await notifyRole({
        roleCode: "RESP_IMPRESSION",
        type: "validation",
        priority: "high",
        title: "BAT signé — bon pour impression",
        body: `Le BAT du manuscrit « ${bat.manuscript.title} » est signé (cycle ${bat.cycleNumber}). Le dossier verrouillé peut être transmis à l'impression.`,
        entityType: "bat_record",
        entityId: id,
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "bat_record",
        entityId: id,
        newValues: { status: "signed", filesHash },
        ipAddress: request.ip,
      });

      return reply.code(201).send(signature);
    },
  );

  // Dépôt du SCAN du BAT Final signé par l'auteur (preuve) — déposé par le
  // service (bat:saisie). Image ou PDF. Possible tant que le BAT n'est pas signé.
  fastify.post("/api/v1/bat/:id/signed-scan", { preHandler: requirePermission("bat", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const bat = await prisma.batRecord.findUnique({ where: { id } });
    if (!bat) return reply.code(404).send({ code: "not_found", message: "BAT introuvable." });
    if (bat.status === BatStatus.signed) return reply.code(409).send({ code: "bat_locked", message: "Le BAT est déjà signé : le dossier est verrouillé." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
    const stored = await storeFile(buffer, `bat-signe-${bat.manuscriptId}-${file.filename}`);
    const doc = await prisma.document.create({
      data: { entityType: "manuscript", entityId: bat.manuscriptId, category: "bat", confidentiality: "interne", title: `BAT signé par l'auteur — cycle ${bat.cycleNumber}`, createdBy: request.user!.id, updatedBy: request.user!.id },
    });
    const version = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: "Scan du BAT Final signé par l'auteur", uploadedBy: request.user!.id },
    });
    await prisma.batRecord.update({ where: { id }, data: { signedScanVersionId: version.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "bat_record", entityId: id, newValues: { signed_scan: true, versionId: version.id }, ipAddress: request.ip });
    return reply.code(201).send({ ok: true, version_id: version.id });
  });

  fastify.get("/api/v1/bat/:id/signed-scan", { preHandler: requirePermission("bat", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const bat = await prisma.batRecord.findUnique({ where: { id }, select: { signedScanVersionId: true } });
    if (!bat?.signedScanVersionId) return reply.code(404).send({ code: "not_found", message: "Aucun scan signé déposé." });
    const version = await prisma.documentVersion.findUnique({ where: { id: bat.signedScanVersionId } });
    if (!version) return reply.code(404).send({ code: "not_found", message: "Scan introuvable." });
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  // Annulation formelle post-signature (Ch. 14 §14.5) : seule voie pour
  // modifier un BAT verrouillé, motivée et notifiée à la direction.
  fastify.post(
    "/api/v1/bat/:id/cancel-signature",
    { preHandler: requirePermission("bat", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = cancelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const bat = await prisma.batRecord.findUnique({ where: { id }, include: { manuscript: true } });
      if (!bat) {
        return reply.code(404).send({ code: "not_found", message: "BAT introuvable." });
      }
      if (bat.status !== BatStatus.signed) {
        return reply.code(409).send({ code: "invalid_transition", message: "Seul un BAT signé peut être annulé." });
      }

      const updated = await prisma.batRecord.update({ where: { id }, data: { status: BatStatus.cancelled } });

      await notifyRole({
        roleCode: "DIR_GENERAL",
        type: "autre",
        priority: "critical",
        title: "Annulation d'un BAT signé",
        body: `Le BAT signé du manuscrit « ${bat.manuscript.title} » (cycle ${bat.cycleNumber}) a été annulé. Motif : ${parsed.data.justification}`,
        entityType: "bat_record",
        entityId: id,
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "bat_record",
        entityId: id,
        newValues: { status: "cancelled", justification: parsed.data.justification },
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );
}
