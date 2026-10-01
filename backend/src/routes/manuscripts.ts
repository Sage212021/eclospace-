import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ManuscriptOrigin, EditorialSegment, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission, requireAuth } from "../lib/permissions.js";
import { canCorrectDeposit, isDeletableStepDoc } from "../lib/stepDocuments.js";
import { CORRECTION_PHASES, COVER_CORRECTION_PHASES, isCorrectionPhase, isCoverCorrectionPhase, isCoverIntegrationDeposit, correctionDocTitle, correctionCycleState, coverCorrectionCycleState, currentCorrectionActor, nextActorAfterPhase } from "../lib/correctionCycle.js";
import { VC1_SLOTS, isVc1Slot, vc1DocTitle, vc1State } from "../lib/startingProof.js";
import { deliverableDocTitle, stepDeliverableMeta } from "../lib/stepDeliverables.js";
import { optionalStepMeta } from "../lib/stepRealization.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyUsers } from "../lib/notify.js";
import { nextManuscriptNumber } from "../lib/manuscriptNumber.js";
import { findDuplicateManuscript, duplicateMessage, normalizeTitleForDuplicate } from "../lib/manuscriptDuplicate.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import type { DocumentCategory } from "@prisma/client";

// Documents de transmission entre étapes (chaîne entrée/sortie). Chaque étape
// dépose son fichier sous un couple (catégorie, titre) réservé, que l'étape
// suivante lit. Catégories distinctes → jamais de collision avec les lectures
// « manuscrit » (source / corrigé) du comité et du correcteur.
const SOURCE_DOC_TITLE = "Manuscrit (source)"; // réception → lecture → correction
const CORRECTED_DOC_TITLE = "Manuscrit corrigé"; // correction → maquette
const LAYOUT_DOC_TITLE = "Maquette (mise en page)"; // maquette → BAT / infographie
const BAT_DOC_TITLE = "BAT signé"; // BAT → impression

// Dernière version du document (catégorie, titre) rattaché à un ouvrage.
async function latestStageVersion(manuscriptId: string, category: DocumentCategory, title: string) {
  const doc = await prisma.document.findFirst({
    where: { entityType: "manuscript", entityId: manuscriptId, category, title, deletedAt: null },
    select: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  return doc?.versions[0] ?? null;
}

// Document d'étape « unique » (maquette, BAT, manuscrit corrigé) : id + auteur,
// pour permettre son retrait (correction d'un dépôt par erreur).
async function stageDocInfo(manuscriptId: string, category: DocumentCategory, title: string) {
  const doc = await prisma.document.findFirst({
    where: { entityType: "manuscript", entityId: manuscriptId, category, title, deletedAt: null },
    select: { id: true, createdBy: true },
  });
  return { doc_id: doc?.id ?? null, uploaded_by: doc?.createdBy ?? null };
}

// Dépôt d'une nouvelle version d'un document d'étape (versionnage conservé).
async function depositStageDoc(
  manuscriptId: string,
  category: DocumentCategory,
  title: string,
  changeSummary: string,
  userId: string,
  file: { filePath: string; fileSize: number; sha256Hash: string },
  mimeType: string,
) {
  let doc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: manuscriptId, category, title, deletedAt: null } });
  if (!doc) {
    doc = await prisma.document.create({ data: { entityType: "manuscript", entityId: manuscriptId, category, title, createdBy: userId, updatedBy: userId } });
  }
  const last = await prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: "desc" } });
  return prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      filePath: file.filePath,
      fileSize: file.fileSize,
      mimeType,
      sha256Hash: file.sha256Hash,
      changeSummary,
      uploadedBy: userId,
    },
  });
}
import { previewSiteFiche, setSitePublished, optimizedCoverForSite, siteCoverThumbnail, UnsupportedImageError } from "../lib/sitePublisher.js";

// Identité de l'auteur collectée à l'enregistrement du manuscrit : nom + tous
// les renseignements repris en tête du contrat d'édition (facultatifs).
const authorSchema = z.union([
  z.object({ author_id: z.string().uuid() }),
  z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    pen_name: z.string().optional(),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(40).optional(),
    address: z.string().max(400).optional(),
    birth_date: z.string().datetime().optional(),
    birth_place: z.string().max(200).optional(),
    nationality: z.string().max(120).optional(),
    profession: z.string().max(200).optional(),
    id_number: z.string().max(120).optional(),
    id_issued_date: z.string().datetime().optional(),
    id_issued_place: z.string().max(200).optional(),
    // Fiche enrichie (grande maison d'édition).
    whatsapp: z.string().max(60).optional(),
    id_type: z.string().max(80).optional(),
    country: z.string().max(120).optional(),
    city: z.string().max(120).optional(),
    quartier: z.string().max(160).optional(),
    postal_box: z.string().max(120).optional(),
    other_contact: z.string().max(200).optional(),
    niu: z.string().max(120).optional(),
  }),
]);

// Champs d'identité optionnels → data Prisma pour la création d'un partenaire.
function authorIdentityData(a: Record<string, unknown>) {
  return {
    email: a.email as string | undefined,
    phone: a.phone as string | undefined,
    whatsapp: a.whatsapp as string | undefined,
    address: a.address as string | undefined,
    birthDate: a.birth_date ? new Date(a.birth_date as string) : undefined,
    birthPlace: a.birth_place as string | undefined,
    nationality: a.nationality as string | undefined,
    profession: a.profession as string | undefined,
    idNumber: a.id_number as string | undefined,
    idIssuedDate: a.id_issued_date ? new Date(a.id_issued_date as string) : undefined,
    idIssuedPlace: a.id_issued_place as string | undefined,
    idType: a.id_type as string | undefined,
    country: a.country as string | undefined,
    city: a.city as string | undefined,
    quartier: a.quartier as string | undefined,
    postalBox: a.postal_box as string | undefined,
    otherContact: a.other_contact as string | undefined,
    niu: a.niu as string | undefined,
  };
}

const createManuscriptSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  collection_id: z.string().uuid().optional(),
  genre_id: z.string().uuid(),
  language: z.string().min(2),
  estimated_pages: z.number().int().positive().optional(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  origin: z.nativeEnum(ManuscriptOrigin).default("soumission"),
  editorial_segment: z.nativeEnum(EditorialSegment).optional(),
  owner_id: z.string().uuid(),
  // Fiche enrichie : choix des frais de dépôt d'évaluation + délai de réponse.
  evaluation_fee_choice: z.enum(["non_defini", "a_payer", "sans_frais"]).optional(),
  author_response_delay_days: z.number().int().min(0).max(365).optional(),
  author: authorSchema,
});

const patchManuscriptSchema = z.object({
  title: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  collection_id: z.string().uuid().optional(),
  genre_id: z.string().uuid().optional(),
  language: z.string().min(2).optional(),
  estimated_pages: z.number().int().positive().optional(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  editorial_segment: z.nativeEnum(EditorialSegment).optional(),
  owner_id: z.string().uuid().optional(),
  project_manager_id: z.string().uuid().optional(),
  requires_expertise: z.boolean().optional(),
  requires_rewrite: z.boolean().optional(),
});

// Correction de la fiche d'enregistrement après coup (ouvrage + identité auteur
// + frais/délai), avec motif obligatoire. Tous les champs sont facultatifs :
// on ne met à jour que ce qui est transmis. Une chaîne vide EFFACE la valeur
// (l'opérateur doit pouvoir retirer une info saisie par erreur).
const editAuthorSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  pen_name: z.string().max(160).optional(),
  email: z.string().email().max(200).or(z.literal("")).optional(),
  phone: z.string().max(40).optional(),
  whatsapp: z.string().max(60).optional(),
  address: z.string().max(400).optional(),
  birth_date: z.string().datetime().or(z.literal("")).optional(),
  birth_place: z.string().max(200).optional(),
  nationality: z.string().max(120).optional(),
  profession: z.string().max(200).optional(),
  id_type: z.string().max(80).optional(),
  id_number: z.string().max(120).optional(),
  id_issued_date: z.string().datetime().or(z.literal("")).optional(),
  id_issued_place: z.string().max(200).optional(),
  country: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  quartier: z.string().max(160).optional(),
  postal_box: z.string().max(120).optional(),
  other_contact: z.string().max(200).optional(),
  niu: z.string().max(120).optional(),
});
const editRegistrationSchema = z.object({
  modification_reason: z.string().trim().min(3).max(500),
  title: z.string().min(1).optional(),
  subtitle: z.string().max(300).optional(),
  language: z.string().min(2).optional(),
  genre_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  evaluation_fee_choice: z.enum(["non_defini", "a_payer", "sans_frais"]).optional(),
  author_response_delay_days: z.number().int().min(0).max(365).nullable().optional(),
  author: editAuthorSchema.optional(),
});

// Identité auteur (édition) → data Prisma : chaîne vide → null (efface), sinon la
// valeur ; dates vides → null. Ne touche qu'aux clés transmises.
function authorIdentityUpdate(a: Record<string, unknown>) {
  const str = (v: unknown) => (v === undefined ? undefined : v === "" ? null : (v as string));
  const date = (v: unknown) => (v === undefined ? undefined : v === "" ? null : new Date(v as string));
  return {
    email: str(a.email), phone: str(a.phone), whatsapp: str(a.whatsapp), address: str(a.address),
    birthDate: date(a.birth_date), birthPlace: str(a.birth_place), nationality: str(a.nationality),
    profession: str(a.profession), idNumber: str(a.id_number), idIssuedDate: date(a.id_issued_date),
    idIssuedPlace: str(a.id_issued_place), idType: str(a.id_type), country: str(a.country),
    city: str(a.city), quartier: str(a.quartier), postalBox: str(a.postal_box),
    otherContact: str(a.other_contact), niu: str(a.niu),
  };
}

const priorityOverrideSchema = z.object({
  score: z.number(),
  justification: z.string().min(1),
});

// Import d'un ouvrage déjà paru (spéc. fonctionnelle §8) : on saisit son état
// actuel, dont sa date de parution historique — pas un manuscrit qui démarre
// le circuit.
const importManuscriptSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  collection_id: z.string().uuid().optional(),
  genre_id: z.string().uuid(),
  language: z.string().min(2),
  estimated_pages: z.number().int().positive().optional(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  editorial_segment: z.nativeEnum(EditorialSegment).optional(),
  owner_id: z.string().uuid(),
  author: authorSchema,
  publication_date: z.coerce.date(),
});

// Antidatage de la date de parution (spéc. fonctionnelle §8) : renseigner
// après coup la date réelle de parution d'un ouvrage, avec conservation de la
// date de saisie effective au journal (§9).
const publicationDateSchema = z.object({
  publication_date: z.coerce.date(),
  note: z.string().optional(),
});

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Catalogue & classements (spéc. fonctionnelle §5/§6) : filtres multicritères
// et tri configurable. Les raccourcis par période (année, mois…) sont traduits
// côté client en bornes published_from/published_to.
const listQuerySchema = z.object({
  status: z.string().optional(),
  collection: z.string().uuid().optional(),
  genre: z.string().uuid().optional(),
  language: z.string().optional(),
  back_catalogue: z.enum(["true", "false"]).optional(),
  published_from: z.coerce.date().optional(),
  published_to: z.coerce.date().optional(),
  q: z.string().optional(),
  priority_min: z.coerce.number().optional(),
  sort: z.enum(["priority", "received_at", "publication_date", "title"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  // « mine » : ne renvoie, à l'étape demandée, que les ouvrages CONFIÉS à
  // l'utilisateur OU pas encore assignés (à prendre) — pour qu'un exécutant
  // (maquettiste…) ne voie pas les dossiers d'un collègue. Exige `status`.
  mine: z.enum(["true", "false"]).optional(),
});

// Secrétariat éditorial (Ch. 6) : point d'entrée unique de tout manuscrit.
export default async function manuscriptRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/manuscripts", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const parsed = createManuscriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;

    // Anti-doublon (demande opérateur 19/08/2026, renforcé 10/09/2026) : un
    // manuscrit ne peut pas être enregistré deux fois sous un titre déjà utilisé
    // par un ouvrage non supprimé. La comparaison est insensible à la casse, aux
    // ACCENTS, à la PONCTUATION, aux TRAITS D'UNION et aux ESPACES multiples —
    // « Management de la Santé du bien-être » ≡ « management de la sante du bien
    // être » (une comparaison au caractère près laissait passer ces variantes).
    const existing = await findDuplicateManuscript(body.title);
    if (existing) {
      return reply.code(409).send({
        code: "duplicate_manuscript",
        message: duplicateMessage(existing, body.title),
      });
    }

    const receptionStatus = await prisma.workflowStatus.findUnique({ where: { code: "RECEPTION" } });
    if (!receptionStatus) {
      return reply.code(500).send({ code: "referential_missing", message: "Statut RECEPTION absent du référentiel (seed manquant)." });
    }
    // L'étape 1 est validée dès la création (voir plus bas) : le manuscrit
    // entre donc directement à l'étape 2 (Ch. 4 §4.3).
    const verificationStatus = await prisma.workflowStatus.findFirstOrThrow({
      where: { stepOrder: receptionStatus.stepOrder + 1 },
    });

    const manuscriptNumber = await nextManuscriptNumber();
    const now = new Date();

    const manuscript = await prisma.$transaction(async (tx) => {
      // L'auteur est un partenaire de catégorie « auteur » (fiche unique
      // couvrant aussi correcteurs, traducteurs, imprimeurs... — décision
      // opérateur du 04/07/2026, voir docs/JOURNAL_TECHNIQUE.md).
      const author =
        "author_id" in body.author
          ? await tx.partner.findUniqueOrThrow({ where: { id: body.author.author_id } })
          : await tx.partner.create({
              data: {
                category: "auteur",
                firstName: body.author.first_name,
                lastName: body.author.last_name,
                penName: body.author.pen_name,
                ...authorIdentityData(body.author as Record<string, unknown>),
                createdBy: request.user!.id,
                updatedBy: request.user!.id,
              },
            });

      const created = await tx.manuscript.create({
        data: {
          manuscriptNumber,
          title: body.title,
          subtitle: body.subtitle,
          collectionId: body.collection_id,
          genreId: body.genre_id,
          language: body.language,
          editorialSegment: body.editorial_segment,
          estimatedPages: body.estimated_pages,
          summary: body.summary,
          keywords: body.keywords,
          origin: body.origin,
          statusId: verificationStatus.id,
          ownerId: body.owner_id,
          receivedAt: now,
          evaluationFeeChoice: body.evaluation_fee_choice ?? "non_defini",
          authorResponseDelayDays: body.author_response_delay_days,
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
          workContributors: {
            create: { partnerId: author.id, role: "author", displayOrder: 0 },
          },
        },
      });

      // Frais de dépôt pour évaluation : si l'éditorial coche « à payer » à
      // l'enregistrement, une demande de facture est initiée automatiquement à
      // destination de la Finance (traçabilité : requestedBy = l'utilisateur).
      if (body.evaluation_fee_choice === "a_payer") {
        await tx.manuscriptFinanceRequest.create({
          data: { manuscriptId: created.id, type: "frais_depot", note: "Frais de dépôt pour évaluation du manuscrit (à l'enregistrement).", requestedBy: request.user!.id },
        });
      }

      // Étape 1 — Réception (Ch. 4 §4.3) : l'enregistrement du dossier
      // constitue lui-même la validation de cette première étape.
      await tx.manuscriptStep.create({
        data: {
          manuscriptId: created.id,
          statusId: receptionStatus.id,
          responsibleId: body.owner_id,
          actualStart: now,
          actualEnd: now,
          validationBy: request.user!.id,
          validatedAt: now,
        },
      });
      await tx.stepTransition.create({
        data: {
          manuscriptId: created.id,
          toStatusCode: receptionStatus.code,
          toDepartmentId: receptionStatus.departmentId,
          responsibleId: request.user!.id,
        },
      });
      await tx.stepTransition.create({
        data: {
          manuscriptId: created.id,
          fromStatusCode: receptionStatus.code,
          toStatusCode: verificationStatus.code,
          fromDepartmentId: receptionStatus.departmentId,
          toDepartmentId: verificationStatus.departmentId,
          responsibleId: request.user!.id,
        },
      });

      return created;
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "manuscript",
      entityId: manuscript.id,
      newValues: { manuscriptNumber, title: body.title },
      ipAddress: request.ip,
    });

    return reply.code(201).send(manuscript);
  });

  // Archivage hiérarchique (spéc. fonctionnelle §7) : projection légère de tous
  // les ouvrages avec les axes de classement (date de parution, collection,
  // domaine, auteur, étape). L'arborescence (année/mois/jour, collection…) est
  // construite côté client à partir de ces axes, dans l'ordre choisi par
  // l'opérateur — pas de combinatoire d'endpoints côté serveur.
  fastify.get("/api/v1/archives", { preHandler: requirePermission("manuscripts", "consultation") }, async (_request, reply) => {
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null },
      include: {
        genre: { select: { label: true } },
        collection: { select: { label: true } },
        status: { select: { code: true, label: true } },
        workContributors: {
          where: { role: "author" },
          orderBy: { displayOrder: "asc" },
          take: 1,
          include: { partner: { select: { firstName: true, lastName: true, penName: true } } },
        },
      },
      orderBy: { publicationDate: "desc" },
    });

    return reply.send(
      rows.map((m) => {
        const partner = m.workContributors[0]?.partner;
        return {
          id: m.id,
          manuscriptNumber: m.manuscriptNumber,
          title: m.title,
          publicationDate: m.publicationDate,
          isBackCatalogue: m.isBackCatalogue,
          genre: m.genre?.label ?? null,
          collection: m.collection?.label ?? null,
          status: m.status,
          author: partner ? partner.penName || `${partner.firstName} ${partner.lastName}` : null,
        };
      }),
    );
  });

  // Import d'un ouvrage déjà paru (spéc. fonctionnelle §8) : entrée directe
  // dans le catalogue avec sa date de parution historique, sans dérouler le
  // circuit de production. Le suivi post-publication devient son étape courante.
  fastify.post("/api/v1/manuscripts/import", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const parsed = importManuscriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;

    if (body.publication_date > startOfToday()) {
      return reply.code(400).send({
        code: "future_publication_date",
        message: "La date de parution d'un ouvrage déjà paru ne peut pas être postérieure à aujourd'hui.",
      });
    }

    // Même garde anti-doublon que le dépôt courant (titre normalisé) : un
    // ouvrage déjà présent au catalogue ne peut pas être ré-importé.
    const importDup = await findDuplicateManuscript(body.title);
    if (importDup) {
      return reply.code(409).send({ code: "duplicate_manuscript", message: duplicateMessage(importDup, body.title) });
    }

    const publishedStatus = await prisma.workflowStatus.findUnique({ where: { code: "SUIVI_POST_PUBLICATION" } });
    if (!publishedStatus) {
      return reply.code(500).send({ code: "referential_missing", message: "Statut SUIVI_POST_PUBLICATION absent du référentiel (seed manquant)." });
    }

    const manuscriptNumber = await nextManuscriptNumber();
    const recordedAt = new Date();

    const manuscript = await prisma.$transaction(async (tx) => {
      const author =
        "author_id" in body.author
          ? await tx.partner.findUniqueOrThrow({ where: { id: body.author.author_id } })
          : await tx.partner.create({
              data: {
                category: "auteur",
                firstName: body.author.first_name,
                lastName: body.author.last_name,
                penName: body.author.pen_name,
                ...authorIdentityData(body.author as Record<string, unknown>),
                createdBy: request.user!.id,
                updatedBy: request.user!.id,
              },
            });

      return tx.manuscript.create({
        data: {
          manuscriptNumber,
          title: body.title,
          subtitle: body.subtitle,
          collectionId: body.collection_id,
          genreId: body.genre_id,
          language: body.language,
          editorialSegment: body.editorial_segment,
          estimatedPages: body.estimated_pages,
          summary: body.summary,
          keywords: body.keywords,
          origin: "soumission",
          statusId: publishedStatus.id,
          ownerId: body.owner_id,
          // Un ouvrage déjà paru n'a pas de « date de réception » : on aligne
          // sur sa parution pour rester cohérent dans les listes.
          receivedAt: body.publication_date,
          publicationDate: body.publication_date,
          isBackCatalogue: true,
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
          workContributors: { create: { partnerId: author.id, role: "author", displayOrder: 0 } },
        },
      });
    });

    // Traçabilité (§9) : on conserve la date de parution historique ET la date
    // de saisie effective, pour distinguer l'antidatage d'une saisie au fil de l'eau.
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "manuscript",
      entityId: manuscript.id,
      newValues: {
        manuscriptNumber,
        title: body.title,
        imported: true,
        back_catalogue: true,
        publication_date: body.publication_date.toISOString(),
        recorded_at: recordedAt.toISOString(),
        antidated: body.publication_date < startOfToday(),
      },
      ipAddress: request.ip,
    });

    return reply.code(201).send(manuscript);
  });

  fastify.get("/api/v1/manuscripts", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const { status, collection, genre, language, back_catalogue, published_from, published_to, q, priority_min, sort, order, mine } = parsed.data;

    // Périmètre personnel (exécutant) : à l'étape demandée, uniquement les
    // ouvrages qui me sont confiés (responsable de l'étape courante) ou pas
    // encore assignés (à prendre). Sans effet si aucune étape n'est demandée.
    const mineFilter =
      mine === "true" && status
        ? {
            OR: [
              { steps: { some: { status: { code: status }, responsibleId: request.user!.id } } },
              { steps: { none: { status: { code: status }, responsibleId: { not: null } } } },
            ],
          }
        : {};

    // Bornes de période sur la date de parution (raccourci « cette année »,
    // « ce mois-ci »… traduits en dates par le client).
    const publicationDateFilter =
      published_from || published_to
        ? { publicationDate: { ...(published_from ? { gte: published_from } : {}), ...(published_to ? { lte: published_to } : {}) } }
        : {};

    const orderByField =
      sort === "title"
        ? { title: order ?? "asc" }
        : sort === "publication_date"
          ? { publicationDate: order ?? "desc" }
          : sort === "received_at"
            ? { receivedAt: order ?? "desc" }
            : { priorityScore: order ?? "desc" };

    // Étape courante demandée : on résout son id une fois pour rattacher, à
    // chaque ouvrage, le responsable de CETTE étape (rangement de la liste :
    // « mes dossiers » / « non assignés » / « confiés à un collègue »).
    const statusRow = status ? await prisma.workflowStatus.findUnique({ where: { code: status }, select: { id: true } }) : null;

    const manuscripts = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: { code: status } } : {}),
        ...(collection ? { collectionId: collection } : {}),
        ...(genre ? { genreId: genre } : {}),
        ...(language ? { language } : {}),
        ...(back_catalogue ? { isBackCatalogue: back_catalogue === "true" } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
        ...publicationDateFilter,
        ...(priority_min !== undefined ? { priorityScore: { gte: priority_min } } : {}),
        ...mineFilter,
      },
      include: {
        status: true,
        genre: true,
        collection: true,
        ...(statusRow
          ? { steps: { where: { statusId: statusRow.id }, select: { responsible: { select: { id: true, username: true } } } } }
          : {}),
      },
      orderBy: orderByField,
    });

    const meId = request.user!.id;
    const withAssignee = manuscripts.map((m) => {
      const steps = (m as unknown as { steps?: { responsible: { id: string; username: string } | null }[] }).steps;
      const resp = steps?.[0]?.responsible ?? null;
      const currentAssignee = resp ? { id: resp.id, username: resp.username } : null;
      const rest: Record<string, unknown> = { ...(m as Record<string, unknown>) };
      delete rest.steps;
      return { ...rest, currentAssignee, assignedToMe: currentAssignee?.id === meId };
    });
    return reply.send(withAssignee);
  });

  // Historique des manuscrits REÇUS / INSCRITS, groupés PAR JOUR (demande
  // opérateur 20/08/2026) : un journal chronologique des dépôts, du plus récent
  // au plus ancien, pour un affichage en accordéon (un jour = une section
  // dépliable). La date de référence est la date de réception (à défaut, la date
  // d'enregistrement dans l'ERP).
  fastify.get("/api/v1/manuscripts/history-by-day", { preHandler: requirePermission("manuscripts", "consultation") }, async (_request, reply) => {
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null },
      select: { id: true, manuscriptNumber: true, title: true, receivedAt: true, createdAt: true, origin: true, status: { select: { label: true, code: true } } },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    });
    const byDay = new Map<string, { id: string; manuscript_number: string; title: string; origin: string | null; status_label: string; status_code: string; at: string }[]>();
    for (const m of rows) {
      const ref = m.receivedAt ?? m.createdAt;
      const key = ref.toISOString().slice(0, 10);
      const list = byDay.get(key) ?? [];
      list.push({
        id: m.id,
        manuscript_number: m.manuscriptNumber,
        title: m.title,
        origin: m.origin ?? null,
        status_label: m.status.label,
        status_code: m.status.code,
        at: ref.toISOString(),
      });
      byDay.set(key, list);
    }
    const days = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, items]) => ({ date, count: items.length, items }));
    return reply.send(days);
  });

  // Fiches du CATALOGUE incomplètes (chemin A) : ouvrages déjà parus dont la
  // fiche manque d'informations clés (ISBN, prix, domaine, identité auteur).
  // Objectif : les compléter sur place, sans rien effacer.
  fastify.get("/api/v1/manuscripts/catalogue-incomplete", { preHandler: requirePermission("manuscripts", "consultation") }, async (_request, reply) => {
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null, OR: [{ isBackCatalogue: true }, { publicationDate: { not: null } }] },
      include: {
        genre: { select: { id: true } },
        isbns: { select: { id: true, priceList: { select: { id: true }, take: 1 } } },
        workContributors: { where: { role: "author" }, include: { partner: { select: { email: true, phone: true, nationality: true, idNumber: true } } }, take: 1 },
      },
      orderBy: { publicationDate: "desc" },
      take: 500,
    });
    const list = rows
      .map((m) => {
        const author = m.workContributors[0]?.partner;
        const authorThin = !author || (!author.email && !author.phone && !author.nationality && !author.idNumber);
        const missing: string[] = [];
        if (m.isbns.length === 0) missing.push("ISBN");
        else if (!m.isbns.some((i) => i.priceList.length > 0)) missing.push("prix");
        if (!m.genreId) missing.push("domaine");
        if (!m.publicationDate) missing.push("date de parution");
        if (authorThin) missing.push("identité auteur");
        return { id: m.id, manuscript_number: m.manuscriptNumber, title: m.title, missing };
      })
      .filter((m) => m.missing.length > 0);
    return reply.send(list);
  });

  // Essais à ÉPURER : manuscrits SANS aucune empreinte catalogue ni financière,
  // donc sûrs à archiver. Les ouvrages publiés ou porteurs de données financières
  // sont exclus (protégés). Réservé à l'administration (DG).
  fastify.get("/api/v1/manuscripts/purge-candidates", { preHandler: requirePermission("manuscripts", "administration") }, async (_request, reply) => {
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null },
      include: {
        status: { select: { label: true, stepOrder: true } },
        sitePublication: { select: { id: true } },
        _count: { select: { isbns: true, contracts: true, financeRequests: true, editorialQuotes: true, expenses: true, costEntries: true, budgets: true, printQuotes: true, schoolRoyaltyEntries: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const list = rows.map((m) => {
      const blockers: string[] = [];
      if (m.publicationDate || m.isBackCatalogue) blockers.push("au catalogue");
      if (m.sitePublication) blockers.push("publié sur le site");
      if (m._count.isbns > 0) blockers.push("ISBN attribué");
      if (m._count.contracts > 0) blockers.push("contrat");
      if (m._count.financeRequests > 0 || m._count.editorialQuotes > 0) blockers.push("devis/facture");
      if (m._count.expenses > 0 || m._count.costEntries > 0 || m._count.budgets > 0) blockers.push("dépenses/coûts");
      if (m._count.printQuotes > 0) blockers.push("devis impression");
      if (m._count.schoolRoyaltyEntries > 0) blockers.push("droits scolaires");
      return {
        id: m.id, manuscript_number: m.manuscriptNumber, title: m.title,
        stage: m.status?.label ?? null, step_order: m.status?.stepOrder ?? null,
        safe: blockers.length === 0, blockers,
      };
    });
    return reply.send(list);
  });

  // DOUBLONS POTENTIELS : ouvrages non supprimés dont le TITRE NORMALISÉ (sans
  // accents/ponctuation/casse) est partagé par au moins deux fiches. Sert à
  // nettoyer les doublons créés AVANT le renforcement de l'anti-doublon. Pour
  // chaque fiche on indique si elle est « sûre » à archiver (aucune empreinte
  // catalogue/financière), afin de retirer le doublon accidentel et de garder
  // la fiche porteuse. Réservé à l'administration.
  fastify.get("/api/v1/manuscripts/duplicates", { preHandler: requirePermission("manuscripts", "administration") }, async (_request, reply) => {
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null },
      include: {
        status: { select: { label: true } },
        workContributors: { where: { role: "author" }, include: { partner: { select: { firstName: true, lastName: true, penName: true } } }, take: 1 },
        _count: { select: { isbns: true, contracts: true, financeRequests: true, editorialQuotes: true, expenses: true, costEntries: true, budgets: true, printQuotes: true, schoolRoyaltyEntries: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 2000,
    });

    const groups = new Map<string, typeof rows>();
    for (const m of rows) {
      const key = normalizeTitleForDuplicate(m.title);
      if (!key) continue;
      const g = groups.get(key);
      if (g) g.push(m);
      else groups.set(key, [m]);
    }

    const result = [...groups.values()]
      .filter((g) => g.length > 1)
      .map((g) => ({
        title: g[0].title,
        count: g.length,
        manuscripts: g.map((m) => {
          const a = m.workContributors[0]?.partner;
          const author = a ? (a.penName || `${a.firstName} ${a.lastName}`.trim()) : null;
          const blockers: string[] = [];
          if (m.publicationDate || m.isBackCatalogue) blockers.push("au catalogue");
          if (m._count.isbns > 0) blockers.push("ISBN attribué");
          if (m._count.contracts > 0) blockers.push("contrat");
          if (m._count.financeRequests > 0 || m._count.editorialQuotes > 0) blockers.push("devis/facture");
          if (m._count.expenses > 0 || m._count.costEntries > 0 || m._count.budgets > 0) blockers.push("dépenses/coûts");
          if (m._count.printQuotes > 0) blockers.push("devis impression");
          if (m._count.schoolRoyaltyEntries > 0) blockers.push("droits scolaires");
          return {
            id: m.id,
            manuscript_number: m.manuscriptNumber,
            title: m.title,
            stage: m.status?.label ?? null,
            author,
            created_at: m.createdAt.toISOString(),
            safe: blockers.length === 0,
            blockers,
          };
        }),
      }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

    return reply.send(result);
  });

  // Archivage (suppression LOGIQUE, réversible) des essais sélectionnés. Chaque
  // ouvrage est RE-VÉRIFIÉ côté serveur : tout ouvrage avec empreinte
  // catalogue/financière est refusé. Réservé à l'administration, tracé au journal.
  fastify.post("/api/v1/manuscripts/purge", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });

    const rows = await prisma.manuscript.findMany({
      where: { id: { in: parsed.data.ids }, deletedAt: null },
      include: {
        sitePublication: { select: { id: true } },
        _count: { select: { isbns: true, contracts: true, financeRequests: true, editorialQuotes: true, expenses: true, costEntries: true, budgets: true, printQuotes: true, schoolRoyaltyEntries: true } },
      },
    });
    const archived: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const m of rows) {
      const hasFootprint =
        m.publicationDate || m.isBackCatalogue || m.sitePublication ||
        m._count.isbns > 0 || m._count.contracts > 0 || m._count.financeRequests > 0 || m._count.editorialQuotes > 0 ||
        m._count.expenses > 0 || m._count.costEntries > 0 || m._count.budgets > 0 || m._count.printQuotes > 0 || m._count.schoolRoyaltyEntries > 0;
      if (hasFootprint) {
        skipped.push({ id: m.id, reason: "empreinte catalogue/financière — protégé" });
        continue;
      }
      await prisma.manuscript.update({ where: { id: m.id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "manuscript", entityId: m.id, oldValues: { deleted: false }, newValues: { deleted: true, reason: "épuration essais" }, ipAddress: request.ip });
      archived.push(m.id);
    }
    return reply.send({ archived_count: archived.length, archived, skipped });
  });

  // Archivage définitif — SCELLER un dossier (lecture seule totale). Réservé à la
  // validation éditoriale ; possible seulement quand le manuscrit est à
  // l'Archivage (parcours complet, ou refusé/abandonné — le refus mène aussi à
  // l'Archivage). Un dossier encore incomplet n'est donc jamais scellé.
  fastify.post("/api/v1/manuscripts/:id/seal", { preHandler: requirePermission("manuscripts", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, include: { status: { select: { code: true } } } });
    if (!m) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    if (m.sealedAt) return reply.code(409).send({ code: "already_sealed", message: "Ce dossier est déjà scellé." });
    if (m.status.code !== "ARCHIVAGE") return reply.code(409).send({ code: "not_archived", message: "Seul un dossier arrivé à l'Archivage peut être scellé. Terminez d'abord le parcours jusqu'à l'archivage réel." });
    await prisma.manuscript.update({ where: { id }, data: { sealedAt: new Date(), sealedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "manuscript", entityId: id, newValues: { sealed: true }, ipAddress: request.ip });
    return reply.send({ id, sealed: true });
  });

  // Réouverture d'un dossier scellé : réservée à l'administration, MOTIF obligatoire,
  // tracée au journal. (Cette route est exemptée du verrou de scellé.)
  fastify.post("/api/v1/manuscripts/:id/unseal", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().min(3).max(500) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "reason_required", message: "Motif de réouverture obligatoire (au moins 3 caractères)." });
    const m = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!m) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    if (!m.sealedAt) return reply.code(409).send({ code: "not_sealed", message: "Ce dossier n'est pas scellé." });
    await prisma.manuscript.update({ where: { id }, data: { sealedAt: null, sealedBy: null } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "manuscript", entityId: id, newValues: { unsealed: true, reason: parsed.data.reason }, ipAddress: request.ip });
    return reply.send({ id, sealed: false });
  });

  fastify.get("/api/v1/manuscripts/:id", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      include: {
        status: true,
        genre: true,
        collection: true,
        owner: { select: { id: true, username: true } },
        projectManager: { select: { id: true, username: true } },
        workContributors: { include: { partner: true } },
        steps: { include: { status: true, responsible: { select: { id: true, username: true } } }, orderBy: { status: { stepOrder: "asc" } } },
      },
    });
    if (!manuscript) {
      return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    }
    // Verrou de la fiche : figée dès qu'un contrat est signé (voir édition fiche).
    const signed = await prisma.contract.findFirst({ where: { manuscriptId: id, deletedAt: null, OR: [{ signedAt: { not: null } }, { status: "active" }] }, select: { id: true } });

    // « Peut clôturer l'étape courante lui-même » : sans le droit large de
    // validation, l'opérateur AFFECTÉ ferme son étape — le correcteur la
    // correction, le maquettiste la mise en page (demande opérateur 26–27/09).
    // Sert à afficher le panneau « valider + choisir la suite » au bon profil.
    let canSelfClose = false;
    if (!request.user!.permissions.has("manuscripts:validation") && ["CORRECTION", "MISE_EN_PAGE", "INFOGRAPHIE", "ATTRIBUTION_REFERENCES"].includes(manuscript.status.code)) {
      const currentStep = manuscript.steps.find((s) => s.statusId === manuscript.statusId);
      canSelfClose = currentStep?.responsibleId === request.user!.id;
      if (!canSelfClose && manuscript.status.code === "CORRECTION") {
        const task = await prisma.task.findFirst({ where: { manuscriptId: id, deletedAt: null, assigneeId: request.user!.id, type: { in: ["correction", "correction_ortho", "correction_gramm", "correction_typo", "correction_syntaxe", "correction_style", "harmonisation", "verif_biblio", "coherence"] as never } }, select: { id: true } });
        canSelfClose = !!task;
      }
      // Dossier NON assigné (« transmis à tout le service ») : l'exécutant du
      // métier de l'étape peut le prendre en charge et le clôturer lui-même —
      // sinon il resterait bloqué sans validateur. Aligné sur canSelfCloseStep
      // (workflow.ts) : production:saisie pour mise en page/infographie,
      // isbn:saisie pour l'attribution des références.
      if (!canSelfClose && (!currentStep || currentStep.responsibleId == null)) {
        const perm = { MISE_EN_PAGE: "production:saisie", INFOGRAPHIE: "production:saisie", ATTRIBUTION_REFERENCES: "isbn:saisie" }[manuscript.status.code];
        canSelfClose = !!perm && request.user!.permissions.has(perm);
      }
    }
    // Responsable de l'ÉTAPE COURANTE + « ce dossier m'est-il confié ? ». Sert
    // au verrou « consultation » : un dossier confié à un collègue est en
    // lecture seule pour les autres (pas de modification accidentelle) ; un
    // responsable peut « prendre le dossier » (motif + traçabilité).
    const currentStepNow = manuscript.steps.find((s) => s.statusId === manuscript.statusId);
    const currentAssignee = currentStepNow?.responsible
      ? { id: currentStepNow.responsible.id, username: currentStepNow.responsible.username }
      : null;
    const assignedToMe = currentAssignee?.id === request.user!.id;
    const elevated =
      request.user!.permissions.has("manuscripts:validation") ||
      request.user!.permissions.has("manuscripts:administration") ||
      request.user!.permissions.has("production:administration");
    // On ne peut « prendre » qu'un dossier confié à quelqu'un d'AUTRE, et
    // seulement aux étapes qui se confient nominativement à une personne.
    const canTakeOver = Boolean(currentAssignee) && !assignedToMe && elevated;
    return reply.send({ ...manuscript, registrationLocked: Boolean(signed), sealed: Boolean(manuscript.sealedAt), canSelfClose, currentAssignee, assignedToMe, canTakeOver });
  });

  // « Prendre le dossier » : un responsable (production/direction) intervient sur
  // un dossier CONFIÉ À UN COLLÈGUE. Motif OBLIGATOIRE, action TRACÉE au journal,
  // et le collègue précédent est notifié — « qui fait quoi » (demande opérateur
  // 30/09). Après reprise, le dossier lui est confié : il quitte la pile « en
  // consultation » et rejoint « ses dossiers à traiter » (plus de confusion).
  fastify.post("/api/v1/manuscripts/:id/step/take-over", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ motif: z.string().trim().min(5, "Motif trop court") }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "motif_required", message: "Un motif d'au moins 5 caractères est obligatoire pour prendre un dossier confié à un collègue." });
    }
    const elevated =
      request.user!.permissions.has("manuscripts:validation") ||
      request.user!.permissions.has("manuscripts:administration") ||
      request.user!.permissions.has("production:administration");
    if (!elevated) {
      return reply.code(403).send({ code: "forbidden", message: "Seul un responsable peut prendre un dossier confié à un collègue." });
    }
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true, title: true, statusId: true, status: { select: { label: true } } } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const step = await prisma.manuscriptStep.findUnique({
      where: { manuscriptId_statusId: { manuscriptId: id, statusId: manuscript.statusId } },
      select: { id: true, responsibleId: true },
    });
    if (!step || !step.responsibleId) {
      return reply.code(409).send({ code: "not_assigned", message: "Ce dossier n'est confié à personne : vous pouvez le traiter directement, aucune reprise n'est nécessaire." });
    }
    if (step.responsibleId === request.user!.id) {
      return reply.code(409).send({ code: "already_mine", message: "Ce dossier vous est déjà confié." });
    }
    const previousId = step.responsibleId;
    const me = await prisma.user.findUnique({ where: { id: request.user!.id }, select: { username: true } });
    await prisma.manuscriptStep.update({ where: { id: step.id }, data: { responsibleId: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "manuscript_step",
      entityId: id,
      oldValues: { step: manuscript.status.label, assigned_to: previousId },
      newValues: { step: manuscript.status.label, assigned_to: request.user!.id, take_over: true, motif: parsed.data.motif },
      ipAddress: request.ip,
    });
    await notifyUsers({
      userIds: [previousId],
      type: "autre",
      priority: "high",
      title: "Dossier repris par un responsable",
      body: `Le dossier « ${manuscript.title} » (étape « ${manuscript.status.label} ») qui vous était confié a été repris par ${me?.username ?? "un responsable"}. Motif : ${parsed.data.motif}`,
      entityType: "manuscript",
      entityId: id,
    });
    return reply.send({ ok: true });
  });

  // Dépôt à la RÉCEPTION : le fichier source du manuscrit. C'est l'entrée du
  // circuit — une fois déposé ici, il est lu par le comité de lecture (« À lire »)
  // puis par le correcteur (« À corriger »). Le déposant (secrétariat éditorial,
  // manuscripts:saisie) n'a pas besoin du droit large « documents » : le fichier
  // est enregistré comme document « Manuscrit (source) » (versionnage conservé).
  fastify.get("/api/v1/manuscripts/:id/source-file/meta", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: id, category: "manuscrit", title: SOURCE_DOC_TITLE, deletedAt: null },
      select: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { mimeType: true } } },
    });
    const v = doc?.versions[0];
    return reply.send({ has_file: Boolean(v), mime_type: v?.mimeType ?? null });
  });

  fastify.get("/api/v1/manuscripts/:id/source-file", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: id, category: "manuscrit", title: SOURCE_DOC_TITLE, deletedAt: null },
      select: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const version = doc?.versions[0];
    if (!version) {
      return reply.code(404).send({ code: "no_source_file", message: "Aucun fichier manuscrit n'a été déposé pour cet ouvrage." });
    }
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  fastify.post("/api/v1/manuscripts/:id/source-file", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
    const stored = await storeFile(buffer, `manuscrit-source-${id}-${file.filename}`);

    let doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: id, category: "manuscrit", title: SOURCE_DOC_TITLE, deletedAt: null },
    });
    if (!doc) {
      doc = await prisma.document.create({
        data: { entityType: "manuscript", entityId: id, category: "manuscrit", title: SOURCE_DOC_TITLE, createdBy: request.user!.id, updatedBy: request.user!.id },
      });
    }
    const last = await prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: "desc" } });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        filePath: stored.filePath,
        fileSize: stored.fileSize,
        mimeType: file.mimetype,
        sha256Hash: stored.sha256Hash,
        changeSummary: "Fichier source déposé à la réception",
        uploadedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { source_manuscript: true, versionNumber: version.versionNumber }, ipAddress: request.ip });
    return reply.code(201).send({ has_file: true, version_number: version.versionNumber });
  });

  // --- Pièces jointes d'étape (dépôt libre de fichiers / scans) --------------
  // Demande opérateur (19/08/2026) : à chaque étape de production, l'acteur peut
  // déposer un fichier ou un document scanné (fiche technique, justificatif,
  // BAT annoté…). Chaque dépôt = un document « pièce d'étape » (confidentialité
  // interne), réutilisant le stockage objet et le versionnage existants. Gouverné
  // par la permission manuscrite (ceux qui travaillent le manuscrit), sans exposer
  // la GED confidentielle (contrats, finance) qui reste sous permission documents.
  fastify.post("/api/v1/manuscripts/:id/step-attachments", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, include: { status: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
    const q = request.query as { step_label?: string };
    const stepLabel = (q.step_label?.trim() || manuscript.status.label).slice(0, 80);
    const stored = await storeFile(buffer, `piece-etape-${id}-${file.filename}`);
    // Marqueur stable « [scan] » : identifie un VRAI dépôt libre (scan/fichier)
    // par opposition aux pièces générées (livrables IA, planning, cycle de
    // correction…). La liste « Documents de l'étape » n'affiche que ces dépôts.
    const doc = await prisma.document.create({
      data: { entityType: "manuscript", entityId: id, category: "piece_etape", confidentiality: "interne", title: `[scan] ${stepLabel} — ${file.filename}`, createdBy: request.user!.id, updatedBy: request.user!.id },
    });
    const version = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: `Pièce déposée à l'étape « ${stepLabel} »`, uploadedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { step_attachment: true, step: stepLabel }, ipAddress: request.ip });
    return reply.code(201).send({ id: doc.id, version_id: version.id, title: doc.title.replace(/^\[scan\]\s*/, "") });
  });

  fastify.get("/api/v1/manuscripts/:id/step-attachments", { preHandler: requireAnyPermission([{ module: "manuscripts", action: "consultation" }, { module: "tasks", action: "consultation" }]) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const docs = await prisma.document.findMany({
      // La liste « Documents de l'étape » ne montre QUE les vrais dépôts libres
      // (scans/fichiers), marqués « [scan] » à l'enregistrement. Toutes les autres
      // pièces d'étape (livrables IA « Manuscrit corrigé », rapports de relecture,
      // planning, cycle de correction, VC1…) ont leurs écrans dédiés et ne
      // polluent plus cette liste.
      where: { entityType: "manuscript", entityId: id, category: "piece_etape", deletedAt: null, title: { startsWith: "[scan] " } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, createdBy: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, fileSize: true, mimeType: true } } },
    });
    return reply.send(
      docs.map((d) => ({
        id: d.id,
        title: d.title.replace(/^\[scan\]\s*/, ""),
        created_at: d.createdAt,
        version_id: d.versions[0]?.id ?? null,
        file_size: d.versions[0]?.fileSize ?? null,
        mime_type: d.versions[0]?.mimeType ?? null,
        // Peut-on retirer ce fichier déposé par erreur ? (auteur du dépôt ou direction)
        can_correct: canCorrectDeposit(request, d.createdBy),
      })),
    );
  });

  // Téléchargement accessible aussi au CORRECTEUR / INTÉGRATEUR (droit « tâches »),
  // pour qu'ils récupèrent les pièces de travail (VC1, versions du cycle de
  // correction) depuis « Mes corrections » sans le droit large « documents ».
  fastify.get("/api/v1/manuscripts/:id/step-attachments/:versionId/download", { preHandler: requireAnyPermission([{ module: "manuscripts", action: "consultation" }, { module: "tasks", action: "consultation" }]) }, async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    const version = await prisma.documentVersion.findFirst({
      where: { id: versionId, document: { entityType: "manuscript", entityId: id, category: "piece_etape", deletedAt: null } },
    });
    if (!version) return reply.code(404).send({ code: "not_found", message: "Pièce introuvable." });
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  // Retirer un fichier d'étape déposé PAR ERREUR (livrable, pièce d'étape,
  // maquette, BAT, manuscrit corrigé…). Suppression LOGIQUE (Modèle §13) :
  // le document est masqué mais conservé ; on peut aussitôt en redéposer un.
  // Réservé à l'AUTEUR du dépôt et à la DIRECTION (demande opérateur 21/08/2026).
  fastify.delete("/api/v1/manuscripts/:id/step-documents/:docId", { preHandler: requireAuth }, async (request, reply) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const doc = await prisma.document.findFirst({
      where: { id: docId, entityType: "manuscript", entityId: id, deletedAt: null },
      select: { id: true, category: true, title: true, createdBy: true },
    });
    if (!doc || !isDeletableStepDoc(doc)) return reply.code(404).send({ code: "not_found", message: "Fichier d'étape introuvable." });
    if (!canCorrectDeposit(request, doc.createdBy)) {
      return reply.code(403).send({ code: "forbidden", message: "Seuls l'auteur du dépôt et la direction peuvent retirer ce fichier." });
    }
    // Motif facultatif (corbeille — cahier des charges IA §45.3) : résultat
    // insatisfaisant, doublon, erreur de génération… conservé au journal d'audit.
    const body = (request.body ?? {}) as { reason?: string; comment?: string };
    await prisma.document.update({ where: { id: docId }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "document", entityId: docId, newValues: { step_document_removed: true, title: doc.title, reason: body.reason ?? null, comment: body.comment ?? null }, ipAddress: request.ip });
    return reply.send({ removed: true });
  });

  // Corbeille du dossier : pièces de travail (rapports IA, versions réécrites,
  // livrables) RETIRÉES du dossier actif — suppression LOGIQUE, jamais physique.
  // On ne liste QUE les documents « retirables » (jamais le manuscrit source ni
  // une pièce protégée) et déjà en corbeille (deletedAt renseigné).
  fastify.get("/api/v1/manuscripts/:id/trash", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const docs = await prisma.document.findMany({
      where: { entityType: "manuscript", entityId: id, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, title: true, category: true, createdAt: true, createdBy: true, deletedAt: true, deletedBy: true },
    });
    return reply.send(
      docs
        .filter((d) => isDeletableStepDoc(d))
        .map((d) => ({
          id: d.id,
          title: d.title,
          category: d.category,
          created_at: d.createdAt,
          deleted_at: d.deletedAt,
          // Restauration réservée à l'auteur du dépôt et à la direction (mêmes
          // règles que le retrait ; jamais un contournement des droits d'accès).
          can_restore: canCorrectDeposit(request, d.createdBy),
        })),
    );
  });

  // Restaurer une pièce depuis la corbeille (remise dans le dossier actif).
  // Conserve l'historique et les numéros de version ; tracée à l'audit.
  fastify.post("/api/v1/manuscripts/:id/step-documents/:docId/restore", { preHandler: requireAuth }, async (request, reply) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const doc = await prisma.document.findFirst({
      where: { id: docId, entityType: "manuscript", entityId: id, deletedAt: { not: null } },
      select: { id: true, category: true, title: true, createdBy: true },
    });
    if (!doc || !isDeletableStepDoc(doc)) return reply.code(404).send({ code: "not_found", message: "Élément de corbeille introuvable." });
    if (!canCorrectDeposit(request, doc.createdBy)) {
      return reply.code(403).send({ code: "forbidden", message: "Seuls l'auteur du dépôt et la direction peuvent restaurer ce fichier." });
    }
    await prisma.document.update({ where: { id: docId }, data: { deletedAt: null, deletedBy: null } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "document", entityId: docId, newValues: { step_document_restored: true, title: doc.title }, ipAddress: request.ip });
    return reply.send({ restored: true });
  });

  // --- Correction éditoriale en deux temps (cycle de 4 phases) ---------------
  // Rapport de correction → intégration → 2e relecture → intégration finale.
  // Chaque phase = un dépôt de fichier (pièce d'étape à titre stable). Consultable
  // et déposable par les acteurs de la correction (droit tasks) ou de l'éditorial
  // (droit manuscrits) ; les fichiers se téléchargent via la route step-attachments.
  fastify.get(
    "/api/v1/manuscripts/:id/correction-cycle",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "consultation" }, { module: "manuscripts", action: "consultation" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const phases = await correctionCycleState(id);
      // Nom du déposant pour le « retour » affiché sur la fiche globale (date +
      // auteur + version) : on résout les identifiants en une seule requête.
      const uploaderIds = [...new Set(phases.map((p) => p.uploaded_by).filter((v): v is string => Boolean(v)))];
      const users = uploaderIds.length ? await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, username: true } }) : [];
      const nameById = new Map(users.map((u) => [u.id, u.username]));
      return reply.send(phases.map((p) => ({ ...p, uploaded_by_name: p.uploaded_by ? nameById.get(p.uploaded_by) ?? null : null, can_correct: p.has_file && canCorrectDeposit(request, p.uploaded_by) })));
    },
  );

  // Rapports de correction de la COUVERTURE (branche infographe) : mêmes pièces
  // d'étape, déposées par le correcteur et exploitées par l'infographe. Distinct
  // du cycle texte ci-dessus (n'entre pas dans le relais « à qui la main »).
  fastify.get(
    "/api/v1/manuscripts/:id/cover-correction-cycle",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "consultation" }, { module: "manuscripts", action: "consultation" }, { module: "production", action: "consultation" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const phases = await coverCorrectionCycleState(id);
      const uploaderIds = [...new Set(phases.map((p) => p.uploaded_by).filter((v): v is string => Boolean(v)))];
      const users = uploaderIds.length ? await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, username: true } }) : [];
      const nameById = new Map(users.map((u) => [u.id, u.username]));
      return reply.send(phases.map((p) => ({ ...p, uploaded_by_name: p.uploaded_by ? nameById.get(p.uploaded_by) ?? null : null, can_correct: p.has_file && canCorrectDeposit(request, p.uploaded_by) })));
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/correction-cycle/:phase",
    // `production:saisie` autorise l'INFOGRAPHE à déposer ses retours de
    // couverture (contrôle fin dans le handler) ; les rôles éditoriaux gardent
    // l'accès complet au cycle.
    { preHandler: requireAnyPermission([{ module: "tasks", action: "saisie" }, { module: "manuscripts", action: "saisie" }, { module: "production", action: "saisie" }]) },
    async (request, reply) => {
      const { id, phase } = request.params as { id: string; phase: string };
      if (!isCorrectionPhase(phase)) return reply.code(400).send({ code: "invalid_phase", message: "Phase de correction inconnue." });
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });

      // L'infographe de l'ouvrage — désigné, sinon responsable étape Infographie.
      const infographeId = await (async () => {
        if (manuscript.coverIntegratorId) return manuscript.coverIntegratorId;
        const st = await prisma.manuscriptStep.findFirst({ where: { manuscriptId: id, status: { code: "INFOGRAPHIE" } }, orderBy: { createdAt: "desc" }, select: { responsibleId: true } });
        return st?.responsibleId ?? null;
      })();
      // Habilitation de dépôt : les rôles éditoriaux (tasks/manuscripts:saisie)
      // gèrent tout le cycle ; un utilisateur seulement « production » (infographe)
      // ne peut déposer QUE ses retours de couverture (retour intégration, finale)
      // et seulement s'il est l'infographe de l'ouvrage.
      const canEditCycle = request.user!.permissions.has("tasks:saisie") || request.user!.permissions.has("manuscripts:saisie");
      if (!canEditCycle) {
        if (!isCoverIntegrationDeposit(phase)) {
          return reply.code(403).send({ code: "forbidden_phase", message: "Vous ne pouvez déposer ici que la couverture intégrée (retour infographie) et la couverture finale." });
        }
        if (infographeId !== request.user!.id) {
          return reply.code(403).send({ code: "not_integrator", message: "Seul l'infographe désigné de cet ouvrage peut déposer le retour de couverture." });
        }
      }
      // VERROU (Lot 3) : la version corrigée finale (VCF) ne peut être déposée que
      // si toutes les corrections retenues (acceptées/modifiées) sont INTÉGRÉES
      // (ou écartées « non applicable » avec motif). Empêche une correction
      // oubliée entre la décision et le fichier livré. Branche TEXTE.
      if (phase === "integration_finale") {
        // ORDRE DU CYCLE : la version corrigée finale (VCF) ne peut être déposée
        // qu'une fois la 1re correction faite (sinon une « finale » apparaîtrait
        // sur un dossier non corrigé — incohérence signalée le 01/10).
        const cycle = await correctionCycleState(id);
        const firstDone = cycle.find((p) => p.key === "rapport_1")?.has_file;
        if (!firstDone) {
          return reply.code(409).send({ code: "first_correction_missing", message: "Impossible de déposer la version corrigée finale : la 1re correction n'a pas encore été déposée. Déposez d'abord la 1re correction." });
        }
        const pending = await prisma.correctionAnomaly.count({
          where: { manuscriptId: id, status: { in: ["acceptee", "modifiee"] }, integrationStatus: { in: ["a_integrer", "a_revoir"] }, job: { workType: { in: ["correction_1", "correction_2"] } } },
        });
        if (pending > 0) {
          return reply.code(409).send({ code: "integration_incomplete", message: `Version finale bloquée : ${pending} correction(s) acceptée(s) ne sont pas encore intégrée(s). Cochez-les « intégrée » (ou « non applicable » avec motif) dans « Mes intégrations de correction » avant de déposer la version finale.` });
        }
      }
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
      const buffer = await file.toBuffer();
      if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
      const label = [...CORRECTION_PHASES, ...COVER_CORRECTION_PHASES].find((p) => p.key === phase)?.label ?? phase;
      const stored = await storeFile(buffer, `correction-${phase}-${id}-${file.filename}`);
      const doc = await prisma.document.create({
        data: { entityType: "manuscript", entityId: id, category: "piece_etape", confidentiality: "interne", title: correctionDocTitle(phase, file.filename), createdBy: request.user!.id, updatedBy: request.user!.id },
      });
      const version = await prisma.documentVersion.create({
        data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: `Correction — ${label}`, uploadedBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { correction_phase: phase }, ipAddress: request.ip });

      // Rapport de correction de COUVERTURE : on notifie l'INFOGRAPHE — celui
      // DÉSIGNÉ pour l'ouvrage en priorité, sinon le responsable de l'étape
      // Infographie —, qui exploitera ce rendu.
      if (isCoverCorrectionPhase(phase)) {
        if (isCoverIntegrationDeposit(phase)) {
          // RETOUR de l'infographe → on notifie le CORRECTEUR (responsable de
          // l'étape Correction) : sa couverture intégrée / finale est prête.
          const step = await prisma.manuscriptStep.findFirst({ where: { manuscriptId: id, status: { code: "CORRECTION" }, validatedAt: null }, select: { responsibleId: true } });
          const correcteur = step?.responsibleId ?? null;
          if (correcteur && correcteur !== request.user!.id) {
            await notifyUsers({ userIds: [correcteur], type: "affectation", priority: "medium", title: `Retour couverture — ${manuscript.manuscriptNumber}`, body: `L'infographe a déposé la couverture ${phase === "couverture_finale" ? "corrigée finale" : "intégrée (BAT2)"} — manuscrit « ${manuscript.title} ».`, entityType: "manuscript", entityId: id });
          }
        } else if (infographeId && infographeId !== request.user!.id) {
          // RAPPORT de couverture (déposé par le correcteur) → on notifie l'infographe.
          await notifyUsers({ userIds: [infographeId], type: "affectation", priority: "medium", title: `Couverture à intégrer — ${manuscript.manuscriptNumber}`, body: `Un rapport de correction de couverture est disponible — manuscrit « ${manuscript.title} ».`, entityType: "manuscript", entityId: id });
        }
        return reply.code(201).send({ version_id: version.id, phase, label });
      }

      // Relais : la balle passe à l'acteur de la phase suivante. Le correcteur
      // (responsable de l'étape) et l'intégrateur (Direction/Assistant éditorial)
      // se renvoient le dossier ; chaque dépôt notifie l'autre.
      const nextActor = nextActorAfterPhase(phase);
      if (nextActor) {
        let targetId: string | null = null;
        let message = "";
        if (nextActor === "integrateur") {
          targetId = manuscript.correctionIntegratorId ?? null;
          message = phase === "rapport_1" ? "Corrections à intégrer (1er passage)" : "Dernières corrections à intégrer";
        } else {
          const step = await prisma.manuscriptStep.findFirst({ where: { manuscriptId: id, status: { code: "CORRECTION" }, validatedAt: null }, select: { responsibleId: true } });
          targetId = step?.responsibleId ?? null;
          message = "Version intégrée à relire (2e passage)";
        }
        if (targetId && targetId !== request.user!.id) {
          await notifyUsers({ userIds: [targetId], type: "affectation", priority: "medium", title: `Correction — ${manuscript.manuscriptNumber}`, body: `${message} — manuscrit « ${manuscript.title} ».`, entityType: "manuscript", entityId: id });
        }
      }
      return reply.code(201).send({ version_id: version.id, phase, label });
    },
  );

  // --- « Version à corriger » (VC1) — dossier de départ déposé à la Décision
  // éditoriale : fichier manuscrit + textes de couverture (1ère/dos/4ème). C'est
  // la matière que le correcteur travaillera à l'étape suivante. Mêmes pièces
  // d'étape que le cycle de correction (aucune migration).
  fastify.get(
    "/api/v1/manuscripts/:id/vc1",
    { preHandler: requireAnyPermission([{ module: "decision_editoriale", action: "consultation" }, { module: "manuscripts", action: "consultation" }, { module: "tasks", action: "consultation" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const slots = await vc1State(id);
      return reply.send(slots.map((s) => ({ ...s, can_correct: s.has_file && canCorrectDeposit(request, s.uploaded_by) })));
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/vc1/:slot",
    { preHandler: requireAnyPermission([{ module: "decision_editoriale", action: "saisie" }, { module: "manuscripts", action: "saisie" }]) },
    async (request, reply) => {
      const { id, slot } = request.params as { id: string; slot: string };
      if (!isVc1Slot(slot)) return reply.code(400).send({ code: "invalid_slot", message: "Emplacement VC1 inconnu." });
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
      const buffer = await file.toBuffer();
      if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
      const label = VC1_SLOTS.find((s) => s.key === slot)!.label;
      const stored = await storeFile(buffer, `vc1-${slot}-${id}-${file.filename}`);
      const doc = await prisma.document.create({
        data: { entityType: "manuscript", entityId: id, category: "piece_etape", confidentiality: "interne", title: vc1DocTitle(slot, file.filename), createdBy: request.user!.id, updatedBy: request.user!.id },
      });
      const version = await prisma.documentVersion.create({
        data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: `Version à corriger (VC1) — ${label}`, uploadedBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { vc1_slot: slot }, ipAddress: request.ip });
      return reply.code(201).send({ version_id: version.id, slot, label });
    },
  );

  // Intégrateur des corrections : la liste des personnes désignables (Direction
  // éditoriale + Assistant éditorial), et la désignation par ouvrage. C'est cet
  // intégrateur qui reçoit le relais après chaque passage du correcteur.
  fastify.get("/api/v1/correction-integrators", { preHandler: requireAuth }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { status: "active", deletedAt: null, userRoles: { some: { revokedAt: null, role: { code: { in: ["DIR_EDITORIAL", "ASSISTANT_EDITORIAL"] } } } } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
    return reply.send(users.map((u) => ({ id: u.id, name: u.username })));
  });

  fastify.get(
    "/api/v1/manuscripts/:id/correction-integrator",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "consultation" }, { module: "manuscripts", action: "consultation" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const m = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { correctionIntegrator: { select: { id: true, username: true } } } });
      if (!m) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const current_actor = await currentCorrectionActor(id);
      return reply.send({ integrator: m.correctionIntegrator ? { id: m.correctionIntegrator.id, name: m.correctionIntegrator.username } : null, current_actor });
    },
  );

  fastify.put(
    "/api/v1/manuscripts/:id/correction-integrator",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "saisie" }, { module: "manuscripts", action: "saisie" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ user_id: z.string().uuid().nullable() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
      const m = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!m) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const userId = parsed.data.user_id;
      if (userId) {
        const ok = await prisma.user.findFirst({ where: { id: userId, status: "active", deletedAt: null, userRoles: { some: { revokedAt: null, role: { code: { in: ["DIR_EDITORIAL", "ASSISTANT_EDITORIAL"] } } } } }, select: { id: true } });
        if (!ok) return reply.code(400).send({ code: "invalid_integrator", message: "L'intégrateur doit faire partie de la Direction éditoriale ou être Assistant éditorial." });
      }
      await prisma.manuscript.update({ where: { id }, data: { correctionIntegratorId: userId, updatedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "manuscript", entityId: id, newValues: { correction_integrator_id: userId }, ipAddress: request.ip });
      if (userId && userId !== request.user!.id) {
        await notifyUsers({ userIds: [userId], type: "affectation", priority: "medium", title: `Intégration des corrections — ${m.manuscriptNumber}`, body: `Vous êtes désigné intégrateur des corrections du manuscrit « ${m.title} ».`, entityType: "manuscript", entityId: id });
      }
      return reply.send({ ok: true });
    },
  );

  // Infographe désigné pour l'intégration de la CORRECTION DE COUVERTURE : la
  // liste des infographes désignables (département Infographie), et la
  // désignation par ouvrage. C'est lui qui reçoit le rapport de correction de
  // couverture. Miroir de l'intégrateur (texte) ci-dessus.
  fastify.get("/api/v1/cover-integrators", { preHandler: requireAuth }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { status: "active", deletedAt: null, userRoles: { some: { revokedAt: null, role: { department: { code: "INFOG" } } } } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
    return reply.send(users.map((u) => ({ id: u.id, name: u.username })));
  });

  fastify.get(
    "/api/v1/manuscripts/:id/cover-integrator",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "consultation" }, { module: "manuscripts", action: "consultation" }, { module: "production", action: "consultation" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const m = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { coverIntegrator: { select: { id: true, username: true } } } });
      if (!m) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      return reply.send({ integrator: m.coverIntegrator ? { id: m.coverIntegrator.id, name: m.coverIntegrator.username } : null });
    },
  );

  fastify.put(
    "/api/v1/manuscripts/:id/cover-integrator",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "saisie" }, { module: "manuscripts", action: "saisie" }]) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ user_id: z.string().uuid().nullable() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
      const m = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!m) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const userId = parsed.data.user_id;
      if (userId) {
        const ok = await prisma.user.findFirst({ where: { id: userId, status: "active", deletedAt: null, userRoles: { some: { revokedAt: null, role: { department: { code: "INFOG" } } } } }, select: { id: true } });
        if (!ok) return reply.code(400).send({ code: "invalid_integrator", message: "L'intégrateur de couverture doit être un infographe (département Infographie)." });
      }
      await prisma.manuscript.update({ where: { id }, data: { coverIntegratorId: userId, updatedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "manuscript", entityId: id, newValues: { cover_integrator_id: userId }, ipAddress: request.ip });
      if (userId && userId !== request.user!.id) {
        await notifyUsers({ userIds: [userId], type: "affectation", priority: "medium", title: `Correction de couverture — ${m.manuscriptNumber}`, body: `Vous êtes désigné infographe pour l'intégration de la correction de couverture du manuscrit « ${m.title} ».`, entityType: "manuscript", entityId: id });
      }
      return reply.send({ ok: true });
    },
  );

  // --- Livrable de sortie d'une étape (verrou « pas d'avancement sans le fichier
  // attendu par l'étape suivante ») ------------------------------------------
  // GET : présence + méta du livrable de l'étape courante. POST : dépôt du
  // fichier livrable (droit tasks:saisie OU manuscripts:saisie). Téléchargement
  // via la route step-attachments (documents « pièce d'étape »).
  fastify.get(
    "/api/v1/manuscripts/:id/step-deliverable/:code",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "consultation" }, { module: "manuscripts", action: "consultation" }]) },
    async (request, reply) => {
      const { id, code } = request.params as { id: string; code: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const meta = await stepDeliverableMeta(id, code);
      return reply.send({ ...meta, can_correct: meta.has_file && canCorrectDeposit(request, meta.uploaded_by) });
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/step-deliverable/:code",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "saisie" }, { module: "manuscripts", action: "saisie" }]) },
    async (request, reply) => {
      const { id, code } = request.params as { id: string; code: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
      const buffer = await file.toBuffer();
      if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
      const stored = await storeFile(buffer, `livrable-${code}-${id}-${file.filename}`);
      const doc = await prisma.document.create({
        data: { entityType: "manuscript", entityId: id, category: "piece_etape", confidentiality: "interne", title: deliverableDocTitle(code, file.filename), createdBy: request.user!.id, updatedBy: request.user!.id },
      });
      const version = await prisma.documentVersion.create({
        data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: `Livrable de l'étape ${code}`, uploadedBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { step_deliverable: code }, ipAddress: request.ip });
      return reply.code(201).send({ version_id: version.id, step_code: code });
    },
  );

  // Étape « à option » (Expertise, Réécriture, Projet) : méta pour piloter le
  // panneau de décision « Réaliser / Passer » et les éléments à renseigner.
  fastify.get(
    "/api/v1/manuscripts/:id/optional-step/:code",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "consultation" }, { module: "manuscripts", action: "consultation" }]) },
    async (request, reply) => {
      const { id, code } = request.params as { id: string; code: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      return reply.send(await optionalStepMeta(id, code));
    },
  );

  fastify.patch("/api/v1/manuscripts/:id", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchManuscriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }

    const existing = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    }

    const body = parsed.data;
    const updated = await prisma.manuscript.update({
      where: { id },
      data: {
        title: body.title,
        subtitle: body.subtitle,
        collectionId: body.collection_id,
        genreId: body.genre_id,
        language: body.language,
        editorialSegment: body.editorial_segment,
        estimatedPages: body.estimated_pages,
        summary: body.summary,
        keywords: body.keywords,
        ownerId: body.owner_id,
        projectManagerId: body.project_manager_id,
        requiresExpertise: body.requires_expertise,
        requiresRewrite: body.requires_rewrite,
        updatedBy: request.user!.id,
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "manuscript",
      entityId: id,
      oldValues: JSON.parse(JSON.stringify(existing)),
      newValues: body,
      ipAddress: request.ip,
    });

    return reply.send(updated);
  });

  // Correction de la fiche d'enregistrement après coup (décision opérateur du
  // 07/08/2026) : on peut réparer une erreur ou un oubli TANT QUE le contrat
  // n'est pas signé. Ensuite la fiche est figée (l'état civil sert au contrat).
  // Motif obligatoire, tout est tracé au journal d'audit.
  fastify.patch("/api/v1/manuscripts/:id/registration", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = editRegistrationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const body = parsed.data;

    const existing = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      include: { workContributors: { where: { role: "author" }, include: { partner: true }, orderBy: { displayOrder: "asc" }, take: 1 } },
    });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });

    // Verrou : un contrat signé (signedAt) ou actif fige la fiche.
    const signed = await prisma.contract.findFirst({ where: { manuscriptId: id, deletedAt: null, OR: [{ signedAt: { not: null } }, { status: "active" }] }, select: { id: true } });
    if (signed) {
      return reply.code(409).send({ code: "registration_locked", message: "Fiche verrouillée : le contrat est signé. L'identité de l'auteur et l'ouvrage servent au contrat et ne peuvent plus être modifiés ici." });
    }

    const authorContributor = existing.workContributors[0];
    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.manuscript.update({
        where: { id },
        data: {
          title: body.title,
          subtitle: body.subtitle,
          language: body.language,
          genreId: body.genre_id,
          ownerId: body.owner_id,
          evaluationFeeChoice: body.evaluation_fee_choice,
          authorResponseDelayDays: body.author_response_delay_days === undefined ? undefined : body.author_response_delay_days,
          updatedBy: request.user!.id,
        },
      });
      if (body.author && authorContributor) {
        await tx.partner.update({
          where: { id: authorContributor.partnerId },
          data: {
            firstName: body.author.first_name,
            lastName: body.author.last_name,
            penName: body.author.pen_name === undefined ? undefined : body.author.pen_name === "" ? null : body.author.pen_name,
            ...authorIdentityUpdate(body.author as Record<string, unknown>),
            updatedBy: request.user!.id,
          },
        });
      }
      return m;
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "manuscript",
      entityId: id,
      oldValues: { title: existing.title, author: authorContributor ? { firstName: authorContributor.partner.firstName, lastName: authorContributor.partner.lastName } : null },
      newValues: { reason: body.modification_reason, ...body },
      ipAddress: request.ip,
    });

    return reply.send(updated);
  });

  // Suppression LOGIQUE d'un manuscrit (contrainte d'intégrité §13 : jamais de
  // suppression physique). Réservée au niveau administration éditoriale. Le
  // dossier disparaît des listes mais reste en base (deletedAt/deletedBy) et
  // l'action est tracée au journal d'audit.
  fastify.post("/api/v1/manuscripts/:id/delete", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable ou déjà supprimé." });
    }
    await prisma.manuscript.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "manuscript",
      entityId: id,
      oldValues: { title: existing.title, manuscriptNumber: existing.manuscriptNumber, deleted: false },
      newValues: { deleted: true },
      ipAddress: request.ip,
    });
    return reply.send({ deleted: true });
  });

  // ── Étape MAQUETTE (mise en page) ──────────────────────────────────────────
  // ENTRÉE : le manuscrit corrigé (produit par la correction). Le maquettiste
  // (production:consultation) le télécharge pour le mettre en page.
  fastify.get("/api/v1/manuscripts/:id/corrected-file", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await latestStageVersion(id, "manuscrit", CORRECTED_DOC_TITLE);
    if (!version) return reply.code(404).send({ code: "no_corrected_file", message: "Aucun manuscrit corrigé n'a été déposé pour cet ouvrage." });
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  // Présence des fichiers d'entrée (manuscrit corrigé) et de sortie (maquette).
  fastify.get("/api/v1/manuscripts/:id/layout-file/meta", { preHandler: requirePermission("production", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const corrected = await latestStageVersion(id, "manuscrit", CORRECTED_DOC_TITLE);
    const layout = await latestStageVersion(id, "livre_monte", LAYOUT_DOC_TITLE);
    const correctedDoc = await stageDocInfo(id, "manuscrit", CORRECTED_DOC_TITLE);
    const layoutDoc = await stageDocInfo(id, "livre_monte", LAYOUT_DOC_TITLE);
    return reply.send({
      corrected_has_file: Boolean(corrected),
      layout_has_file: Boolean(layout),
      corrected_doc_id: correctedDoc.doc_id,
      corrected_can_correct: Boolean(corrected) && canCorrectDeposit(request, correctedDoc.uploaded_by),
      layout_doc_id: layoutDoc.doc_id,
      layout_can_correct: Boolean(layout) && canCorrectDeposit(request, layoutDoc.uploaded_by),
    });
  });

  // SORTIE : la maquette mise en page (reçue ensuite par le BAT et l'infographie).
  fastify.get("/api/v1/manuscripts/:id/layout-file", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await latestStageVersion(id, "livre_monte", LAYOUT_DOC_TITLE);
    if (!version) return reply.code(404).send({ code: "no_layout_file", message: "Aucune maquette n'a été déposée pour cet ouvrage." });
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  fastify.post("/api/v1/manuscripts/:id/layout-file", { preHandler: requirePermission("production", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
    const stored = await storeFile(buffer, `maquette-${id}-${file.filename}`);
    const version = await depositStageDoc(id, "livre_monte", LAYOUT_DOC_TITLE, "Maquette déposée (mise en page)", request.user!.id, stored, file.mimetype);
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { layout: true, versionNumber: version.versionNumber }, ipAddress: request.ip });
    return reply.code(201).send({ has_file: true, version_number: version.versionNumber });
  });

  // ── Étape BAT (bon à tirer) ─────────────────────────────────────────────────
  // ENTRÉE : la maquette (via layout-file). SORTIE : le BAT signé, reçu par
  // l'impression. Présence des deux fichiers pour la fiche.
  fastify.get("/api/v1/manuscripts/:id/bat-file/meta", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const layout = await latestStageVersion(id, "livre_monte", LAYOUT_DOC_TITLE);
    const bat = await latestStageVersion(id, "bat", BAT_DOC_TITLE);
    const batDoc = await stageDocInfo(id, "bat", BAT_DOC_TITLE);
    return reply.send({
      layout_has_file: Boolean(layout),
      bat_has_file: Boolean(bat),
      bat_doc_id: batDoc.doc_id,
      bat_can_correct: Boolean(bat) && canCorrectDeposit(request, batDoc.uploaded_by),
    });
  });

  fastify.get("/api/v1/manuscripts/:id/bat-file", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await latestStageVersion(id, "bat", BAT_DOC_TITLE);
    if (!version) return reply.code(404).send({ code: "no_bat_file", message: "Aucun BAT signé n'a été déposé pour cet ouvrage." });
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  fastify.post("/api/v1/manuscripts/:id/bat-file", { preHandler: requirePermission("bat", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
    const stored = await storeFile(buffer, `bat-signe-${id}-${file.filename}`);
    const version = await depositStageDoc(id, "bat", BAT_DOC_TITLE, "BAT signé déposé", request.user!.id, stored, file.mimetype);
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { bat_signed: true, versionNumber: version.versionNumber }, ipAddress: request.ip });
    return reply.code(201).send({ has_file: true, version_number: version.versionNumber });
  });

  // Frise chronologique (Ch. 4 §4.4).
  fastify.get(
    "/api/v1/manuscripts/:id/timeline",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const allStatuses = await prisma.workflowStatus.findMany({ orderBy: { stepOrder: "asc" }, include: { department: true } });
      const steps = await prisma.manuscriptStep.findMany({ where: { manuscriptId: id }, include: { responsible: { select: { username: true } } } });
      const stepByStatusId = new Map(steps.map((step) => [step.statusId, step]));
      const currentOrder = allStatuses.find((s) => s.id === manuscript.statusId)?.stepOrder ?? 0;

      const timeline = allStatuses.map((status) => {
        const step = stepByStatusId.get(status.id);
        // Statut de l'étape sur la frise : terminée (validée) / en cours (étape
        // courante de l'ouvrage) / à venir.
        const state = status.id === manuscript.statusId ? "current" : status.stepOrder < currentOrder || step?.validatedAt ? "done" : "todo";
        return {
          status_code: status.code,
          label: status.label,
          step_order: status.stepOrder,
          is_conditional: status.isConditional,
          state,
          department: status.department?.name ?? null,
          assignee: step?.responsible?.username ?? null,
          started_at: step?.actualStart ?? null,
          validated_at: step?.validatedAt ?? null,
          planned_end: step?.plannedEnd ?? null,
          actual_end: step?.actualEnd ?? null,
          late: Boolean(step?.plannedEnd && step.actualEnd && step.actualEnd > step.plannedEnd),
        };
      });

      return reply.send(timeline);
    },
  );

  // Ajustement manuel de la priorité par la Direction éditoriale (Ch. 6 §6.5) — tracé.
  fastify.post(
    "/api/v1/manuscripts/:id/priority-override",
    { preHandler: requirePermission("manuscripts", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = priorityOverrideSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const existing = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const updated = await prisma.manuscript.update({
        where: { id },
        data: {
          priorityOverride: parsed.data.score,
          priorityOverrideJustification: parsed.data.justification,
          updatedBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "manuscript",
        entityId: id,
        oldValues: { priorityOverride: existing.priorityOverride },
        newValues: parsed.data,
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  // Date de parution / antidatage (spéc. fonctionnelle §8) : renseigner ou
  // corriger la date réelle de parution d'un ouvrage. Le journal conserve la
  // date de saisie effective et signale l'antidatage (date antérieure à ce jour).
  fastify.post(
    "/api/v1/manuscripts/:id/publication-date",
    { preHandler: requirePermission("manuscripts", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = publicationDateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Date invalide.", details: parsed.error.issues });
      }

      const existing = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const recordedAt = new Date();
      const updated = await prisma.manuscript.update({
        where: { id },
        data: { publicationDate: parsed.data.publication_date, updatedBy: request.user!.id },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "manuscript",
        entityId: id,
        oldValues: { publication_date: existing.publicationDate?.toISOString() ?? null },
        newValues: {
          change: "publication_date",
          publication_date: parsed.data.publication_date.toISOString(),
          recorded_at: recordedAt.toISOString(),
          antidated: parsed.data.publication_date < startOfToday(),
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        },
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  // ── Fiche « site vitrine » (prête à publier) ────────────────────────────────
  // Le site étant sur-mesure (sans API), l'ERP prépare une fiche prête à copier
  // (titre, auteur, genre, prix, ISBN, résumé) + l'état de publication.
  fastify.get(
    "/api/v1/manuscripts/:id/site-publication",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        return reply.send(await previewSiteFiche(id));
      } catch (err) {
        return reply.code(404).send({ code: "not_found", message: err instanceof Error ? err.message : "Ouvrage introuvable." });
      }
    },
  );

  // Couverture « prête pour le web » : image légère (JPG de très bonne qualité,
  // ≤ 1600 px), transformée à la volée depuis la couverture d'impression déposée.
  // C'est ce fichier que le maquettiste joint à la fiche sur le site.
  fastify.get(
    "/api/v1/manuscripts/:id/site-cover",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { size } = request.query as { size?: string };
      try {
        // Aperçu : miniature légère mise en cache (évite de ré-optimiser la
        // couverture pleine taille à chaque affichage). Repli sur la version web
        // complète si la miniature échoue.
        if (size === "thumb") {
          const thumb = await siteCoverThumbnail(id);
          if (thumb) {
            reply.header("content-type", thumb.mime);
            reply.header("cache-control", "private, max-age=300");
            return reply.send(thumb.buffer);
          }
        }
        const cover = await optimizedCoverForSite(id);
        if (!cover) {
          return reply.code(404).send({ code: "no_cover", message: "Aucune couverture (image) déposée pour cet ouvrage." });
        }
        reply.header("content-type", cover.mime);
        reply.header("content-disposition", `attachment; filename="${cover.filename}"`);
        return reply.send(cover.buffer);
      } catch (err) {
        if (err instanceof UnsupportedImageError) {
          return reply.code(422).send({ code: "unsupported_image", message: err.message });
        }
        return reply.code(404).send({ code: "not_found", message: err instanceof Error ? err.message : "Ouvrage introuvable." });
      }
    },
  );

  // Marque l'ouvrage comme publié (ou non) sur le site, avec le lien éventuel de
  // la fiche en ligne — pour que l'ERP garde la trace de ce qui est sur le site.
  const markSchema = z.object({ published: z.boolean(), url: z.string().url().optional().or(z.literal("")) });
  fastify.post(
    "/api/v1/manuscripts/:id/site-publication",
    { preHandler: requirePermission("manuscripts", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = markSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      try {
        const result = await setSitePublished(id, { id: request.user!.id, ip: request.ip }, parsed.data.published, parsed.data.url || null);
        return reply.send({ ok: true, ...result });
      } catch (err) {
        return reply.code(404).send({ code: "not_found", message: err instanceof Error ? err.message : "Ouvrage introuvable." });
      }
    },
  );

  // Prise en charge & jalon devis (reconfiguration Finance, non bloquant). Permet
  // de fixer le mode (compte d'éditeur/auteur) et de trancher le jalon devis :
  // « établir » (demande à la Finance, notifiée), « plus tard » ou « passer »
  // (justifié). Aucune de ces options n'empêche le travail éditorial.
  fastify.patch("/api/v1/manuscripts/:id/funding", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        funding_mode: z.enum(["publisher", "author"]).optional(),
        decision: z.enum(["pending", "requested", "deferred", "skipped"]).optional(),
        note: z.string().max(500).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
    const ms = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!ms) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });

    const data: Prisma.ManuscriptUpdateInput = {};
    if (parsed.data.funding_mode) data.fundingMode = parsed.data.funding_mode;
    if (parsed.data.decision) {
      if (parsed.data.decision === "skipped" && !parsed.data.note?.trim()) {
        return reply.code(400).send({ code: "note_required", message: "Une justification est requise pour passer l'étape du devis." });
      }
      data.quoteDecision = parsed.data.decision;
      data.quoteDecisionNote = parsed.data.decision === "skipped" ? parsed.data.note?.trim() ?? null : null;
      data.quoteDecisionAt = new Date();
      data.quoteDecisionBy = request.user!.id;
    }
    const updated = await prisma.manuscript.update({ where: { id }, data });

    if (parsed.data.decision === "requested") {
      const staff = await prisma.user.findMany({
        where: { status: "active", deletedAt: null, accountType: "internal", userRoles: { some: { revokedAt: null, role: { rolePermissions: { some: { permission: { module: "finance", action: "saisie" } } } } } } },
        select: { id: true },
      });
      if (staff.length) {
        await notifyUsers({ userIds: staff.map((u) => u.id), type: "autre", priority: "medium", title: "Devis à établir", body: `${ms.title} (${ms.manuscriptNumber})`, entityType: "manuscript", entityId: id }).catch(() => {});
      }
    }
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "manuscript", entityId: id, newValues: { fundingMode: updated.fundingMode, quoteDecision: updated.quoteDecision }, ipAddress: request.ip });
    return reply.send({ funding_mode: updated.fundingMode, quote_decision: updated.quoteDecision, quote_decision_note: updated.quoteDecisionNote });
  });
}
