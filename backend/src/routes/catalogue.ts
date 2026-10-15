import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../lib/permissions.js";
import { readStoredFile } from "../lib/storage.js";
import { writeAuditLog } from "../lib/audit.js";

// Pôle Marketing & Distribution — module CATALOGUE des ouvrages.
//
// Règle STRICTE d'alimentation (validée avec l'opérateur) : n'apparaissent que
// les ouvrages PUBLIÉS — entrés en commercialisation — et ARCHIVÉS (étape ≥ 17).
// Jamais un manuscrit en cours, une maquette ou un BAT non publié.
//
// Alimentation AUTOMATIQUE depuis le référentiel des ouvrages (fiche unique) :
// aucune re-saisie. La couverture provient de la pièce « couverture » déposée
// sur la fiche ouvrage (infographie) ; le prix et la disponibilité viennent de
// la fiche commerciale (work_metadata). Un ouvrage retiré du commerce reste au
// catalogue avec le statut « épuisé / arrêté » — son historique n'est pas perdu.
const COMMERCIALISATION_STEP_ORDER = 17;

const DEFAULT_SORT_KEY = "catalogue_default_sort";
const SORTS = ["recent", "oldest", "az", "za", "author", "collection", "genre"] as const;
type Sort = (typeof SORTS)[number];

const AVAILABILITY: Record<string, string> = {
  a_paraitre: "À paraître",
  disponible: "Disponible",
  epuise: "Épuisé",
  arret_commercialisation: "Arrêté",
};

type Row = {
  id: string;
  reference: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  collection: { id: string; label: string } | null;
  genre: { id: string; label: string } | null;
  publicationDate: string | null;
  year: number | null;
  pricePublic: number | null;
  availability: string; // libellé
  availabilityCode: string | null;
  isBackCatalogue: boolean;
  summary: string | null;
  hasCover: boolean;
};

function contains(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase("fr").includes(needle.toLocaleLowerCase("fr"));
}

export default async function catalogueRoutes(fastify: FastifyInstance) {
  // Liste du catalogue (+ facettes de filtrage + tri par défaut de la maison).
  // Ouverte à tout le personnel connecté : ce sont des ouvrages publiés, non
  // confidentiels (couvertures, titres, prix publics).
  fastify.get("/api/v1/catalogue", { preHandler: requireAuth }, async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>;

    const cfgRow = await prisma.setting.findUnique({ where: { key: DEFAULT_SORT_KEY } });
    const defaultSort: Sort = (SORTS as readonly string[]).includes(String(cfgRow?.value)) ? (cfgRow!.value as Sort) : "recent";
    const sort: Sort = (SORTS as readonly string[]).includes(String(q.sort)) ? (q.sort as Sort) : defaultSort;

    const works = await prisma.manuscript.findMany({
      where: { deletedAt: null, status: { stepOrder: { gte: COMMERCIALISATION_STEP_ORDER } } },
      select: {
        id: true,
        manuscriptNumber: true,
        title: true,
        subtitle: true,
        publicationDate: true,
        isBackCatalogue: true,
        summary: true,
        collection: { select: { id: true, label: true } },
        genre: { select: { id: true, label: true } },
        workContributors: {
          where: { role: "author" },
          orderBy: { displayOrder: "asc" },
          select: { partner: { select: { firstName: true, lastName: true } } },
        },
        workMetadata: { select: { pricePublic: true, commercializationStatus: true } },
      },
    });

    // Présence d'une couverture image : soit une pièce « couverture » dédiée,
    // soit — automatiquement — la couverture (1ʳᵉ) produite par l'infographe
    // (ImageAsset couverture_1) quand elle est une image. Ainsi le travail de
    // l'infographe alimente le catalogue sans dépôt manuel (demande opérateur 28/09).
    const ids = works.map((w) => w.id);
    const [coverDocs, coverAssets] = ids.length
      ? await Promise.all([
          prisma.document.findMany({
            where: { entityType: "manuscript", entityId: { in: ids }, category: "couverture", deletedAt: null, versions: { some: { mimeType: { startsWith: "image/" } } } },
            select: { entityId: true },
          }),
          prisma.imageAsset.findMany({
            where: { manuscriptId: { in: ids }, type: "couverture_1", deletedAt: null, documentVersion: { mimeType: { startsWith: "image/" } } },
            select: { manuscriptId: true },
          }),
        ])
      : [[], []];
    const withCover = new Set<string>([...coverDocs.map((d) => d.entityId), ...coverAssets.map((a) => a.manuscriptId)]);

    let rows: Row[] = works.map((w) => {
      const authors = w.workContributors
        .map((c) => `${c.partner.firstName} ${c.partner.lastName}`.trim())
        .filter(Boolean);
      const code = w.workMetadata?.commercializationStatus ?? null;
      return {
        id: w.id,
        reference: w.manuscriptNumber,
        title: w.title,
        subtitle: w.subtitle,
        authors,
        collection: w.collection ? { id: w.collection.id, label: w.collection.label } : null,
        genre: w.genre ? { id: w.genre.id, label: w.genre.label } : null,
        publicationDate: w.publicationDate ? w.publicationDate.toISOString() : null,
        year: w.publicationDate ? w.publicationDate.getUTCFullYear() : null,
        pricePublic: w.workMetadata?.pricePublic != null ? Number(w.workMetadata.pricePublic) : null,
        availability: code ? AVAILABILITY[code] ?? "Disponible" : "Disponible",
        availabilityCode: code,
        isBackCatalogue: w.isBackCatalogue,
        summary: w.summary,
        hasCover: withCover.has(w.id),
      };
    });

    // Facettes (avant filtrage) pour alimenter les listes déroulantes.
    const facetCollections = uniqueBy(rows.flatMap((r) => (r.collection ? [r.collection] : [])), (c) => c.id);
    const facetGenres = uniqueBy(rows.flatMap((r) => (r.genre ? [r.genre] : [])), (g) => g.id);
    const facetYears = Array.from(new Set(rows.map((r) => r.year).filter((y): y is number => y != null))).sort((a, b) => b - a);

    // Filtres.
    const search = (q.q ?? "").trim();
    if (search) rows = rows.filter((r) => contains(r.title, search) || (r.subtitle && contains(r.subtitle, search)) || r.authors.some((a) => contains(a, search)) || contains(r.reference, search));
    if (q.collection) rows = rows.filter((r) => r.collection?.id === q.collection);
    if (q.genre) rows = rows.filter((r) => r.genre?.id === q.genre);
    if (q.year) rows = rows.filter((r) => String(r.year) === q.year);
    if (q.availability) rows = rows.filter((r) => r.availabilityCode === q.availability);

    // Tri.
    const byAuthor = (r: Row) => (r.authors[0] ?? "").toLocaleLowerCase("fr");
    rows.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (a.publicationDate ?? "9999").localeCompare(b.publicationDate ?? "9999");
        case "az":
          return a.title.localeCompare(b.title, "fr");
        case "za":
          return b.title.localeCompare(a.title, "fr");
        case "author":
          return byAuthor(a).localeCompare(byAuthor(b), "fr");
        case "collection":
          return (a.collection?.label ?? "").localeCompare(b.collection?.label ?? "", "fr");
        case "genre":
          return (a.genre?.label ?? "").localeCompare(b.genre?.label ?? "", "fr");
        case "recent":
        default:
          // Plus récent d'abord ; dates nulles en fin de liste.
          return (b.publicationDate ?? "0000").localeCompare(a.publicationDate ?? "0000");
      }
    });

    return reply.send({
      items: rows,
      sort,
      defaultSort,
      sorts: SORTS,
      facets: { collections: facetCollections, genres: facetGenres, years: facetYears, availability: Object.entries(AVAILABILITY).map(([code, label]) => ({ code, label })) },
    });
  });

  // Couverture d'un ouvrage du catalogue : sert la dernière version image de la
  // pièce « couverture » de la fiche ouvrage. Gardée par la simple connexion
  // (couverture publique), et bornée aux ouvrages publiés/archivés.
  fastify.get("/api/v1/catalogue/:id/cover", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const published = await prisma.manuscript.findFirst({ where: { id, deletedAt: null, status: { stepOrder: { gte: COMMERCIALISATION_STEP_ORDER } } }, select: { id: true } });
    if (!published) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable au catalogue." });
    const doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: id, category: "couverture", deletedAt: null, versions: { some: { mimeType: { startsWith: "image/" } } } },
      select: { versions: { where: { mimeType: { startsWith: "image/" } }, orderBy: { versionNumber: "desc" }, take: 1, select: { filePath: true, mimeType: true } } },
      orderBy: { createdAt: "desc" },
    });
    let cover: { filePath: string; mimeType: string } | null = doc?.versions[0] ?? null;
    // Repli automatique : la couverture (1ʳᵉ) de l'infographe, si c'est une image.
    if (!cover) {
      const asset = await prisma.imageAsset.findFirst({
        where: { manuscriptId: id, type: "couverture_1", deletedAt: null, documentVersion: { mimeType: { startsWith: "image/" } } },
        orderBy: { createdAt: "desc" },
        select: { documentVersion: { select: { filePath: true, mimeType: true } } },
      });
      if (asset?.documentVersion) cover = { filePath: asset.documentVersion.filePath, mimeType: asset.documentVersion.mimeType };
    }
    if (!cover) return reply.code(404).send({ code: "no_cover", message: "Pas de couverture pour cet ouvrage." });
    const buffer = await readStoredFile(cover.filePath);
    reply.header("content-type", cover.mimeType);
    reply.header("cache-control", "private, max-age=3600");
    return reply.send(buffer);
  });

  // Tri par défaut du catalogue : lecture ouverte (chacun peut ensuite choisir
  // son propre tri sans changer le défaut) ; écriture réservée à l'administration
  // (DG / RH / Administrateur — même périmètre que le babillard, D-027).
  fastify.get("/api/v1/catalogue/config", { preHandler: requireAuth }, async (_request, reply) => {
    const row = await prisma.setting.findUnique({ where: { key: DEFAULT_SORT_KEY } });
    const defaultSort: Sort = (SORTS as readonly string[]).includes(String(row?.value)) ? (row!.value as Sort) : "recent";
    return reply.send({ defaultSort, sorts: SORTS });
  });

  fastify.put("/api/v1/catalogue/config", { preHandler: requirePermission("communication", "administration") }, async (request, reply) => {
    const parsed = z.object({ default_sort: z.enum(SORTS) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Tri par défaut invalide." });
    await prisma.setting.upsert({
      where: { key: DEFAULT_SORT_KEY },
      update: { value: parsed.data.default_sort, updatedBy: request.user!.id },
      create: { key: DEFAULT_SORT_KEY, value: parsed.data.default_sort, updatedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "catalogue_config", entityId: DEFAULT_SORT_KEY, newValues: { default_sort: parsed.data.default_sort }, ipAddress: request.ip });
    return reply.send({ defaultSort: parsed.data.default_sort });
  });

  // Résumé (« légende ») d'un ouvrage du catalogue — saisi/collé depuis la fiche
  // détaillée du catalogue par le pôle Marketing (communication:administration).
  // Alimente `manuscript.summary`, affiché en dépliable dans le catalogue.
  fastify.patch("/api/v1/catalogue/:id/summary", { preHandler: requirePermission("communication", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ summary: z.string().max(8000) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Résumé invalide (8000 caractères max)." });
    const ms = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!ms) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });
    await prisma.manuscript.update({ where: { id }, data: { summary: parsed.data.summary.trim() || null } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "catalogue_summary", entityId: id, newValues: { length: parsed.data.summary.trim().length }, ipAddress: request.ip });
    return reply.send({ ok: true, summary: parsed.data.summary.trim() || null });
  });

  // Corrige le domaine (genre) d'un ouvrage directement depuis la fiche du
  // catalogue — utile après un import de fonds où le genre était approximatif.
  fastify.patch("/api/v1/catalogue/:id/genre", { preHandler: requirePermission("communication", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ genre_id: z.string().uuid() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Domaine invalide." });
    const ms = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!ms) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });
    const genre = await prisma.genre.findFirst({ where: { id: parsed.data.genre_id, deletedAt: null }, select: { id: true, label: true } });
    if (!genre) return reply.code(404).send({ code: "genre_not_found", message: "Domaine introuvable." });
    await prisma.manuscript.update({ where: { id }, data: { genreId: genre.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "catalogue_genre", entityId: id, newValues: { genreId: genre.id, genreLabel: genre.label }, ipAddress: request.ip });
    return reply.send({ ok: true, genre: { id: genre.id, label: genre.label } });
  });
}

function uniqueBy<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}
