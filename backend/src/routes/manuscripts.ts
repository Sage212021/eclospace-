import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ManuscriptOrigin, EditorialSegment, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission, requireAuth } from "../lib/permissions.js";
import { canCorrectDeposit, isDeletableStepDoc } from "../lib/stepDocuments.js";
import { CORRECTION_PHASES, isCorrectionPhase, correctionDocTitle, correctionCycleState } from "../lib/correctionCycle.js";
import { deliverableDocTitle, stepDeliverableMeta } from "../lib/stepDeliverables.js";
import { optionalStepMeta } from "../lib/stepRealization.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyUsers } from "../lib/notify.js";
import { nextManuscriptNumber } from "../lib/manuscriptNumber.js";
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
});

// Secrétariat éditorial (Ch. 6) : point d'entrée unique de tout manuscrit.
export default async function manuscriptRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/manuscripts", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const parsed = createManuscriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;

    // Anti-doublon (demande opérateur 19/08/2026) : un manuscrit ne peut pas être
    // enregistré deux fois sous un titre déjà utilisé par un ouvrage ACTIF —
    // sauf si le premier a été totalement supprimé. Comparaison insensible à la
    // casse et aux espaces de bord. Message explicite pointant l'existant.
    const dupTitle = body.title.trim();
    const existing = await prisma.manuscript.findFirst({
      where: { deletedAt: null, title: { equals: dupTitle, mode: "insensitive" } },
      select: { manuscriptNumber: true, status: { select: { label: true } } },
    });
    if (existing) {
      return reply.code(409).send({
        code: "duplicate_manuscript",
        message: `Un manuscrit « ${dupTitle} » est déjà enregistré sous ${existing.manuscriptNumber} (étape : ${existing.status.label}). Reprenez cette fiche, ou supprimez-la d'abord si vous voulez la ré-enregistrer.`,
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
    const { status, collection, genre, language, back_catalogue, published_from, published_to, q, priority_min, sort, order } = parsed.data;

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
      },
      include: { status: true, genre: true, collection: true },
      orderBy: orderByField,
    });
    return reply.send(manuscripts);
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
        steps: { include: { status: true }, orderBy: { status: { stepOrder: "asc" } } },
      },
    });
    if (!manuscript) {
      return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    }
    // Verrou de la fiche : figée dès qu'un contrat est signé (voir édition fiche).
    const signed = await prisma.contract.findFirst({ where: { manuscriptId: id, deletedAt: null, OR: [{ signedAt: { not: null } }, { status: "active" }] }, select: { id: true } });
    return reply.send({ ...manuscript, registrationLocked: Boolean(signed) });
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
    const doc = await prisma.document.create({
      data: { entityType: "manuscript", entityId: id, category: "piece_etape", confidentiality: "interne", title: `${stepLabel} — ${file.filename}`, createdBy: request.user!.id, updatedBy: request.user!.id },
    });
    const version = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: `Pièce déposée à l'étape « ${stepLabel} »`, uploadedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { step_attachment: true, step: stepLabel }, ipAddress: request.ip });
    return reply.code(201).send({ id: doc.id, version_id: version.id, title: doc.title });
  });

  fastify.get("/api/v1/manuscripts/:id/step-attachments", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const docs = await prisma.document.findMany({
      where: { entityType: "manuscript", entityId: id, category: "piece_etape", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, createdBy: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, fileSize: true, mimeType: true } } },
    });
    return reply.send(
      docs.map((d) => ({
        id: d.id,
        title: d.title,
        created_at: d.createdAt,
        version_id: d.versions[0]?.id ?? null,
        file_size: d.versions[0]?.fileSize ?? null,
        mime_type: d.versions[0]?.mimeType ?? null,
        // Peut-on retirer ce fichier déposé par erreur ? (auteur du dépôt ou direction)
        can_correct: canCorrectDeposit(request, d.createdBy),
      })),
    );
  });

  fastify.get("/api/v1/manuscripts/:id/step-attachments/:versionId/download", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
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
    await prisma.document.update({ where: { id: docId }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "document", entityId: docId, newValues: { step_document_removed: true, title: doc.title }, ipAddress: request.ip });
    return reply.send({ removed: true });
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
      return reply.send(phases.map((p) => ({ ...p, can_correct: p.has_file && canCorrectDeposit(request, p.uploaded_by) })));
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/correction-cycle/:phase",
    { preHandler: requireAnyPermission([{ module: "tasks", action: "saisie" }, { module: "manuscripts", action: "saisie" }]) },
    async (request, reply) => {
      const { id, phase } = request.params as { id: string; phase: string };
      if (!isCorrectionPhase(phase)) return reply.code(400).send({ code: "invalid_phase", message: "Phase de correction inconnue." });
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
      const buffer = await file.toBuffer();
      if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
      const label = CORRECTION_PHASES.find((p) => p.key === phase)!.label;
      const stored = await storeFile(buffer, `correction-${phase}-${id}-${file.filename}`);
      const doc = await prisma.document.create({
        data: { entityType: "manuscript", entityId: id, category: "piece_etape", confidentiality: "interne", title: correctionDocTitle(phase, file.filename), createdBy: request.user!.id, updatedBy: request.user!.id },
      });
      const version = await prisma.documentVersion.create({
        data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: `Correction — ${label}`, uploadedBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { correction_phase: phase }, ipAddress: request.ip });
      return reply.code(201).send({ version_id: version.id, phase, label });
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

      const allStatuses = await prisma.workflowStatus.findMany({ orderBy: { stepOrder: "asc" } });
      const steps = await prisma.manuscriptStep.findMany({ where: { manuscriptId: id } });
      const stepByStatusId = new Map(steps.map((step) => [step.statusId, step]));

      const timeline = allStatuses.map((status) => {
        const step = stepByStatusId.get(status.id);
        return {
          status_code: status.code,
          label: status.label,
          step_order: status.stepOrder,
          is_conditional: status.isConditional,
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
