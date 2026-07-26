import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "../lib/prisma.js";
import { requireAuthor, requirePermission } from "../lib/permissions.js";
import { validatePasswordComplexity } from "../lib/passwordPolicy.js";
import { writeAuditLog } from "../lib/audit.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import { notifyUsers } from "../lib/notify.js";
import type { FastifyRequest } from "fastify";

const MAX_LABEL = 120;

// Lecture d'un envoi multipart : le fichier + un champ texte « label » optionnel.
async function readUpload(request: FastifyRequest): Promise<{ buf: Buffer; name: string; mime: string; label: string } | null> {
  if (!request.isMultipart()) return null;
  let buf: Buffer | null = null;
  let name = "fichier";
  let mime = "application/octet-stream";
  let label = "";
  for await (const part of request.parts()) {
    if (part.type === "file") {
      buf = await part.toBuffer();
      name = part.filename || "fichier";
      mime = part.mimetype || "application/octet-stream";
    } else if (part.fieldname === "label" && typeof part.value === "string") {
      label = part.value.slice(0, MAX_LABEL);
    }
  }
  if (!buf || buf.byteLength === 0) return null;
  return { buf, name, mime, label };
}

function fileView(f: { id: string; label: string; fileName: string; fileMime: string; fileSize: number; direction: string; createdAt: Date }) {
  return {
    id: f.id,
    label: f.label,
    name: f.fileName,
    mime: f.fileMime,
    size: f.fileSize,
    direction: f.direction,
    from_house: f.direction === "to_author",
    created_at: f.createdAt,
  };
}

// Espace Auteur — incrément 1 (demande opérateur du 26/07/2026).
// Portail réservé aux comptes externes reliés à une fiche Partenaire (auteur).
// Isolation stricte : toutes les lectures sont cantonnées au partnerId du compte
// connecté (un auteur ne voit QUE ses propres ouvrages). Aucun accès à l'ERP.

// Étapes du circuit éditorial présentées à l'auteur, en langage clair (sans le
// jargon interne). On mappe les codes de statut du workflow vers un libellé
// lisible et un ordre d'affichage stable.
const AUTHOR_STAGES: { match: RegExp; fr: string; en: string }[] = [
  { match: /reception|depot|soumission/i, fr: "Dépôt reçu", en: "Submission received" },
  { match: /lecture|comite|expert/i, fr: "En lecture", en: "Under review" },
  { match: /decision/i, fr: "Décision éditoriale", en: "Editorial decision" },
  { match: /contrat|contractual/i, fr: "Contrat", en: "Contract" },
  { match: /correction|reecriture|revision/i, fr: "Correction", en: "Copy-editing" },
  { match: /maquette|mise.?en.?page|infograph/i, fr: "Maquette", en: "Layout" },
  { match: /bat|bon.?a.?tirer/i, fr: "Bon à tirer (BAT)", en: "Proof approval" },
  { match: /impression|tirage/i, fr: "Impression", en: "Printing" },
  { match: /stock|entree|reception.?stock/i, fr: "En stock", en: "In stock" },
  { match: /publi|parution|commercial|vente|post/i, fr: "Publié", en: "Published" },
];

function friendlyStage(code: string, label: string): { fr: string; en: string } {
  const hit = AUTHOR_STAGES.find((s) => s.match.test(code));
  return hit ? { fr: hit.fr, en: hit.en } : { fr: label, en: label };
}

export default async function authorRoutes(fastify: FastifyInstance) {
  // Profil de l'auteur connecté (nom d'affichage, e-mail, nb d'ouvrages).
  fastify.get("/api/v1/author/me", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) return reply.code(404).send({ code: "not_found", message: "Fiche auteur introuvable." });
    const worksCount = await prisma.workContributor.count({ where: { partnerId, role: "author", manuscript: { deletedAt: null } } });
    const displayName = partner.penName || `${partner.firstName} ${partner.lastName}`.trim();
    return reply.send({
      name: displayName,
      email: partner.email ?? request.user!.email,
      works_count: worksCount,
    });
  });

  // Liste des ouvrages de l'auteur, avec leur avancement (statut courant lisible).
  fastify.get("/api/v1/author/works", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const contributions = await prisma.workContributor.findMany({
      where: { partnerId, role: "author", manuscript: { deletedAt: null } },
      include: { manuscript: { include: { status: true } } },
      orderBy: { manuscript: { receivedAt: "desc" } },
    });
    const works = contributions.map((c) => {
      const m = c.manuscript;
      const stage = friendlyStage(m.status.code, m.status.label);
      return {
        id: m.id,
        title: m.title,
        subtitle: m.subtitle,
        reference: m.manuscriptNumber,
        stage_fr: stage.fr,
        stage_en: stage.en,
        step_order: m.status.stepOrder,
        received_at: m.receivedAt,
        publication_date: m.publicationDate,
        published: Boolean(m.publicationDate),
      };
    });
    return reply.send(works);
  });

  // Détail d'un ouvrage : fil des étapes franchies / en cours / à venir.
  fastify.get("/api/v1/author/works/:id", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const { id } = request.params as { id: string };
    // Contrôle d'appartenance : l'ouvrage doit être rattaché à CET auteur.
    const contribution = await prisma.workContributor.findFirst({
      where: { partnerId, role: "author", manuscriptId: id, manuscript: { deletedAt: null } },
    });
    if (!contribution) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });

    const m = await prisma.manuscript.findUnique({ where: { id }, include: { status: true } });
    if (!m) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });

    const steps = await prisma.manuscriptStep.findMany({
      where: { manuscriptId: id },
      include: { status: true },
      orderBy: { status: { stepOrder: "asc" } },
    });
    const current = m.status.stepOrder;
    const timeline = steps.map((s) => {
      const stage = friendlyStage(s.status.code, s.status.label);
      // État lisible : terminé (validé/clos), en cours (statut courant), à venir.
      const done = Boolean(s.validatedAt || s.actualEnd);
      const state = done ? "done" : s.status.stepOrder === current ? "current" : s.status.stepOrder < current ? "done" : "upcoming";
      return {
        stage_fr: stage.fr,
        stage_en: stage.en,
        step_order: s.status.stepOrder,
        state,
        done_at: s.validatedAt ?? s.actualEnd ?? null,
      };
    });
    const stage = friendlyStage(m.status.code, m.status.label);
    return reply.send({
      id: m.id,
      title: m.title,
      subtitle: m.subtitle,
      reference: m.manuscriptNumber,
      stage_fr: stage.fr,
      stage_en: stage.en,
      received_at: m.receivedAt,
      publication_date: m.publicationDate,
      timeline,
    });
  });

  // --- Côté personnel (éditorial/administration) : créer/relier un compte
  // auteur à une fiche Partenaire (invitation). Réservé à l'administration des
  // comptes. Le mot de passe initial est fixé par l'agent (l'envoi d'un e-mail
  // d'activation viendra dans un incrément ultérieur).
  const createAccountSchema = z.object({
    username: z.string().min(3).max(60),
    password: z.string().min(1),
  });
  fastify.post(
    "/api/v1/partners/:partnerId/author-account",
    { preHandler: requirePermission("users", "administration") },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };
      const parsed = createAccountSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });

      const partner = await prisma.partner.findFirst({ where: { id: partnerId, deletedAt: null }, include: { userAccount: true } });
      if (!partner) return reply.code(404).send({ code: "not_found", message: "Fiche partenaire introuvable." });
      if (partner.category !== "auteur") return reply.code(400).send({ code: "not_author", message: "Seule une fiche de catégorie « auteur » peut recevoir un compte auteur." });
      if (partner.userAccount) return reply.code(409).send({ code: "account_exists", message: "Cette fiche auteur a déjà un compte." });
      if (!partner.email) return reply.code(400).send({ code: "missing_email", message: "La fiche auteur doit comporter un e-mail avant de créer un compte." });

      const complexity = validatePasswordComplexity(parsed.data.password);
      if (complexity) return reply.code(400).send({ code: "weak_password", message: complexity });

      if (await prisma.user.findFirst({ where: { username: parsed.data.username, deletedAt: null } })) {
        return reply.code(409).send({ code: "username_taken", message: `L'identifiant « ${parsed.data.username} » est déjà utilisé.` });
      }
      if (await prisma.user.findFirst({ where: { email: partner.email, deletedAt: null } })) {
        return reply.code(409).send({ code: "email_taken", message: `L'e-mail « ${partner.email} » est déjà utilisé par un compte.` });
      }

      const passwordHash = await argon2.hash(parsed.data.password);
      const user = await prisma.user.create({
        data: {
          username: parsed.data.username,
          email: partner.email,
          passwordHash,
          status: "active",
          accountType: "external",
          partnerId: partner.id,
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
        },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "author_account", entityId: user.id, newValues: { partnerId: partner.id, username: user.username }, ipAddress: request.ip });
      return reply.code(201).send({ id: user.id, username: user.username, email: user.email });
    },
  );

  // ── Échange de fichiers auteur ↔ maison (inc. 2a) ──────────────────────────

  // Vérifie qu'un ouvrage appartient bien à l'auteur connecté.
  async function assertOwnWork(partnerId: string, manuscriptId: string): Promise<boolean> {
    const c = await prisma.workContributor.findFirst({ where: { partnerId, role: "author", manuscriptId, manuscript: { deletedAt: null } } });
    return Boolean(c);
  }

  // Fichiers d'un de mes ouvrages (déposés par moi ET partagés par la maison).
  fastify.get("/api/v1/author/works/:id/files", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const { id } = request.params as { id: string };
    if (!(await assertOwnWork(partnerId, id))) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });
    const files = await prisma.authorFile.findMany({ where: { manuscriptId: id, partnerId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    return reply.send(files.map(fileView));
  });

  // Dépôt d'un fichier par l'auteur (manuscrit, corrections, illustrations…).
  fastify.post("/api/v1/author/works/:id/files", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const { id } = request.params as { id: string };
    if (!(await assertOwnWork(partnerId, id))) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });
    const upload = await readUpload(request);
    if (!upload) return reply.code(400).send({ code: "validation_error", message: "Aucun fichier reçu." });
    const stored = await storeFile(upload.buf, upload.name);
    const created = await prisma.authorFile.create({
      data: { manuscriptId: id, partnerId, direction: "from_author", label: upload.label, fileName: upload.name, filePath: stored.filePath, fileMime: upload.mime, fileSize: stored.fileSize, uploadedById: request.user!.id },
    });
    // Prévient l'équipe en charge de l'ouvrage (responsable + chef de projet).
    const m = await prisma.manuscript.findUnique({ where: { id }, select: { title: true, ownerId: true, projectManagerId: true } });
    const staff = [...new Set([m?.ownerId, m?.projectManagerId].filter((x): x is string => Boolean(x)))];
    if (staff.length) {
      await notifyUsers({ userIds: staff, type: "autre", priority: "medium", title: "Nouveau fichier d'un auteur", body: `${upload.label || upload.name} — « ${m?.title ?? ""} »`, entityType: "manuscript", entityId: id }).catch(() => {});
    }
    return reply.code(201).send(fileView(created));
  });

  // Téléchargement d'un fichier de l'un de mes ouvrages (portée partnerId).
  fastify.get("/api/v1/author/files/:fileId/download", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const { fileId } = request.params as { fileId: string };
    const f = await prisma.authorFile.findFirst({ where: { id: fileId, partnerId, deletedAt: null } });
    if (!f) return reply.code(404).send({ code: "not_found", message: "Fichier introuvable." });
    const buffer = await readStoredFile(f.filePath);
    reply.header("content-type", f.fileMime);
    reply.header("content-disposition", `attachment; filename="${f.fileName.replace(/"/g, "")}"`);
    return reply.send(buffer);
  });

  // Suppression logique d'un fichier que J'AI déposé (pas ceux de la maison).
  fastify.delete("/api/v1/author/files/:fileId", { preHandler: requireAuthor }, async (request, reply) => {
    const partnerId = request.user!.partnerId!;
    const { fileId } = request.params as { fileId: string };
    const f = await prisma.authorFile.findFirst({ where: { id: fileId, partnerId, deletedAt: null } });
    if (!f) return reply.code(404).send({ code: "not_found", message: "Fichier introuvable." });
    if (f.direction !== "from_author") return reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez retirer que les fichiers que vous avez déposés." });
    await prisma.authorFile.update({ where: { id: fileId }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    return reply.send({ ok: true });
  });

  // ── Côté personnel : voir les dépôts de l'auteur et lui partager des fichiers.

  async function authorPartnerOf(manuscriptId: string): Promise<string | null> {
    const c = await prisma.workContributor.findFirst({ where: { manuscriptId, role: "author" }, orderBy: { displayOrder: "asc" } });
    return c?.partnerId ?? null;
  }

  fastify.get("/api/v1/manuscripts/:id/author-files", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const files = await prisma.authorFile.findMany({ where: { manuscriptId: id, deletedAt: null }, orderBy: { createdAt: "desc" } });
    return reply.send(files.map((f) => ({ ...fileView(f), uploaded_by: f.uploadedById })));
  });

  fastify.post("/api/v1/manuscripts/:id/author-files", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const partnerId = await authorPartnerOf(id);
    if (!partnerId) return reply.code(400).send({ code: "no_author", message: "Cet ouvrage n'a pas d'auteur enregistré." });
    const upload = await readUpload(request);
    if (!upload) return reply.code(400).send({ code: "validation_error", message: "Aucun fichier reçu." });
    const stored = await storeFile(upload.buf, upload.name);
    const created = await prisma.authorFile.create({
      data: { manuscriptId: id, partnerId, direction: "to_author", label: upload.label, fileName: upload.name, filePath: stored.filePath, fileMime: upload.mime, fileSize: stored.fileSize, uploadedById: request.user!.id },
    });
    // Prévient l'auteur (si son compte existe) qu'un document lui est partagé.
    const account = await prisma.user.findFirst({ where: { partnerId, accountType: "external", status: "active", deletedAt: null }, select: { id: true } });
    if (account) {
      await notifyUsers({ userIds: [account.id], type: "autre", priority: "medium", title: "Un document vous a été partagé", body: upload.label || upload.name, entityType: "manuscript", entityId: id }).catch(() => {});
    }
    return reply.code(201).send(fileView(created));
  });

  fastify.get("/api/v1/manuscripts/:id/author-files/:fileId/download", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id, fileId } = request.params as { id: string; fileId: string };
    const f = await prisma.authorFile.findFirst({ where: { id: fileId, manuscriptId: id, deletedAt: null } });
    if (!f) return reply.code(404).send({ code: "not_found", message: "Fichier introuvable." });
    const buffer = await readStoredFile(f.filePath);
    reply.header("content-type", f.fileMime);
    reply.header("content-disposition", `attachment; filename="${f.fileName.replace(/"/g, "")}"`);
    return reply.send(buffer);
  });
}
