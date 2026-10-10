import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IsbnFormat, LegalDepositStatus, MetadataExportFormat, IsbnStatus } from "@prisma/client";
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
  // Correction d'une saisie (pays / organisme / exemplaires / échéance).
  country: z.string().min(1).optional(),
  depository: z.string().min(1).optional(),
  copies_required: z.number().int().positive().optional(),
  due_date: z.string().datetime().nullable().optional(),
  // Suivi du dépôt.
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
  // Fiche ouvrage — volet commercial & financier (§3, §4). Nullable pour
  // permettre d'effacer un champ (null) ou de le laisser inchangé (absent).
  edition_type: z.enum(["compte_editeur", "compte_auteur", "coedition", "coproduction", "partenariat", "autre"]).nullish(),
  price_public: z.number().nonnegative().nullish(),
  price_pro: z.number().nonnegative().nullish(),
  pro_discount_pct: z.number().min(0).max(100).nullish(),
  price_editeur: z.number().nonnegative().nullish(),
  editor_discount_pct: z.number().min(0).max(100).nullish(),
  price_promo: z.number().nonnegative().nullish(),
  unit_production_cost: z.number().nonnegative().nullish(),
  commercialization_status: z.enum(["a_paraitre", "disponible", "epuise", "arret_commercialisation"]).nullish(),
  is_school_book: z.boolean().optional(),
  school_level: z.string().max(120).nullish(),
  school_subject: z.string().max(120).nullish(),
  school_year: z.string().max(60).nullish(),
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
        manuscript: {
          select: {
            title: true, subtitle: true, editorialSegment: true,
            // Auteur (premier contributeur « author ») pour l'affichage et la
            // recherche par auteur dans les sélecteurs d'ouvrage (remise, etc.).
            workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { firstName: true, lastName: true } } } },
          },
        },
        // Prix courant (dernier tarif) : permet de pré-remplir le prix unitaire
        // au moment de la sélection d'un ouvrage dans une commande à facturer.
        priceList: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { price: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(isbns.map((i) => {
      const c = i.manuscript?.workContributors?.[0]?.partner;
      const author = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null : null;
      return { ...i, author, price_ht: i.priceList[0] ? Number(i.priceList[0].price) : null };
    }));
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

      // Décision opérateur D-010 (18/08/2026) : la contractualisation a été
      // déplacée APRÈS la validation du BAT. L'attribution des références (ISBN)
      // se fait à l'étape 11, donc AVANT le contrat — l'ancien blocage « aucun
      // contrat actif : l'ISBN ne peut pas être attribué » (Ch. 13 §13.3) est
      // retiré en conséquence, cohérent avec le retrait du verrou de production.

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

  // ═══ BANQUE DES ISBN (Lot 1) ═══════════════════════════════════════════════
  // Source centrale de référence des ISBN d'Éclosion : tous les ISBN enregistrés
  // (ceux du catalogue sont déjà des enregistrements), classés par STATUT, avec
  // recherche (numéro / titre / auteur), filtres et tableau de bord. L'unicité
  // d'un numéro est garantie par la base (isbn13 unique) ; un ISBN n'est jamais
  // supprimé.
  //   Statuts « banque » (regroupent les statuts techniques) :
  //     DISPONIBLE = available | reserved   ATTRIBUÉ = assigned | published
  //     ANNULÉ     = cancelled
  fastify.get("/api/v1/isbn-bank", { preHandler: requirePermission("isbn", "consultation") }, async (request, reply) => {
    const q = request.query as { q?: string; status?: string; format?: string };
    const rows = await prisma.isbn.findMany({
      include: {
        manuscript: {
          select: {
            id: true, title: true, manuscriptNumber: true,
            workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    // Résolution des noms d'utilisateur ayant attribué (champ texte, pas de relation).
    const byIds = [...new Set(rows.map((r) => r.assignedBy).filter((v): v is string => !!v))];
    const users = byIds.length ? await prisma.user.findMany({ where: { id: { in: byIds } }, select: { id: true, username: true } }) : [];
    const userName = new Map(users.map((u) => [u.id, u.username]));

    const bankStatus = (s: IsbnStatus): "disponible" | "attribue" | "annule" =>
      s === "cancelled" ? "annule" : s === "assigned" || s === "published" ? "attribue" : "disponible";

    const all = rows.map((i) => {
      const c = i.manuscript?.workContributors?.[0]?.partner;
      const mAuthor = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null : null;
      return {
        id: i.id,
        isbn13: i.isbn13,
        bank_status: bankStatus(i.status),
        status: i.status,
        format: i.format,
        // Titre/auteur : le manuscrit lié fait foi ; sinon les champs portés par
        // l'ISBN (anciens numéros importés sans manuscrit).
        title: i.manuscript?.title ?? i.title ?? null,
        author: mAuthor ?? i.authorName ?? null,
        manuscript_id: i.manuscript?.id ?? null,
        manuscript_number: i.manuscript?.manuscriptNumber ?? null,
        assigned_at: i.assignedAt ? i.assignedAt.toISOString() : null,
        assigned_by: i.assignedBy ? (userName.get(i.assignedBy) ?? null) : null,
        observations: i.observations ?? null,
        created_at: i.createdAt.toISOString(),
      };
    });

    // Tableau de bord : compteurs sur l'ENSEMBLE de la banque (indépendants des filtres).
    const summary = {
      total: all.length,
      disponible: all.filter((x) => x.bank_status === "disponible").length,
      attribue: all.filter((x) => x.bank_status === "attribue").length,
      annule: all.filter((x) => x.bank_status === "annule").length,
    };

    const needle = (q.q ?? "").trim().toLowerCase();
    const items = all.filter((x) => {
      if (q.status && x.bank_status !== q.status) return false;
      if (q.format && x.format !== q.format) return false;
      if (needle) {
        const hay = `${x.isbn13} ${x.title ?? ""} ${x.author ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    return reply.send({ summary, items });
  });

  // Annuler un ISBN (Banque) : le rend INUTILISABLE (plus proposé à l'attribution)
  // sans le supprimer. Autorisé UNIQUEMENT depuis « disponible » / « réservé » —
  // un ISBN déjà ATTRIBUÉ à un ouvrage ne peut pas être annulé (le livre le porte).
  fastify.post("/api/v1/isbn/:id/cancel", { preHandler: requirePermission("isbn", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ observations: z.string().max(500).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
    const isbn = await prisma.isbn.findUnique({ where: { id } });
    if (!isbn) return reply.code(404).send({ code: "not_found", message: "ISBN introuvable." });
    if (isbn.status === "cancelled") {
      return reply.code(409).send({ code: "already_cancelled", message: "Cet ISBN est déjà annulé." });
    }
    if (isbn.status === "assigned" || isbn.status === "published") {
      return reply.code(409).send({ code: "isbn_attributed", message: "Impossible d'annuler un ISBN déjà attribué à un ouvrage. Un ISBN attribué reste rattaché à son ouvrage (jamais réutilisé)." });
    }
    const updated = await prisma.isbn.update({
      where: { id },
      data: { status: "cancelled", observations: parsed.data.observations ?? isbn.observations },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "isbn", entityId: id, oldValues: { status: isbn.status }, newValues: { status: "cancelled", observations: parsed.data.observations ?? null }, ipAddress: request.ip });
    return reply.send(updated);
  });

  // Import des anciens ISBN (Lot 4, spec §7) : intègre dans la banque les ISBN
  // des anciens registres (le frontend lit le CSV/Excel et envoie des lignes).
  // Contrôle des doublons OBLIGATOIRE : un numéro déjà présent est IGNORÉ (jamais
  // deux fois le même ISBN). Résumé renvoyé (créés / doublons / erreurs).
  fastify.post("/api/v1/isbn-bank/import", { preHandler: requirePermission("isbn", "administration") }, async (request, reply) => {
    const schema = z.object({
      rows: z.array(z.object({
        isbn13: z.string().min(1),
        title: z.string().optional(),
        author: z.string().optional(),
        format: z.nativeEnum(IsbnFormat).optional(),
        status: z.enum(["disponible", "attribue", "annule"]).optional(),
        assigned_at: z.string().optional(),
        observations: z.string().optional(),
      })).min(1).max(5000),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Fichier invalide : aucune ligne exploitable." });

    const statusMap = { disponible: "available", attribue: "assigned", annule: "cancelled" } as const;
    let created = 0;
    const duplicates: string[] = [];
    const errors: { line: number; isbn13: string; reason: string }[] = [];
    // Dédoublonnage AUSSI à l'intérieur du fichier (deux fois le même numéro).
    const seen = new Set<string>();

    for (let idx = 0; idx < parsed.data.rows.length; idx++) {
      const row = parsed.data.rows[idx];
      const line = idx + 1;
      const norm = row.isbn13.replace(/[^0-9Xx]/g, "").toUpperCase();
      if (!norm) { errors.push({ line, isbn13: row.isbn13, reason: "numéro ISBN vide ou invalide" }); continue; }
      if (seen.has(norm)) { duplicates.push(norm); continue; }
      seen.add(norm);
      const existing = await prisma.isbn.findFirst({ where: { OR: [{ isbn13: row.isbn13 }, { isbn13: norm }] }, select: { id: true } });
      if (existing) { duplicates.push(norm); continue; }
      const status = row.status ? statusMap[row.status] : (row.title ? "assigned" : "available");
      let assignedAt: Date | null = null;
      if (row.assigned_at) { const d = new Date(row.assigned_at); if (!isNaN(d.getTime())) assignedAt = d; }
      try {
        await prisma.isbn.create({
          data: {
            isbn13: norm,
            format: row.format ?? "print",
            status,
            title: row.title?.trim() || null,
            authorName: row.author?.trim() || null,
            assignedAt: status === "assigned" ? (assignedAt ?? new Date()) : assignedAt,
            assignedBy: status === "assigned" ? request.user!.id : null,
            observations: row.observations?.trim() || "Importé d'un ancien registre.",
          },
        });
        created++;
      } catch {
        errors.push({ line, isbn13: norm, reason: "création impossible (numéro en conflit ?)" });
      }
    }
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "isbn", entityId: "import", newValues: { created, duplicates: duplicates.length, errors: errors.length }, ipAddress: request.ip });
    return reply.send({ created, duplicates: duplicates.length, errors });
  });

  // ═══ CHARGEMENT DE NOUVEAUX ISBN DISPONIBLES (écran Administrateur) ══════════
  // Charge dans la banque des ISBN NEUFS, non encore utilisés, au statut
  // « disponible ». Pensé pour l'administrateur qui reçoit une nouvelle tranche
  // de l'agence ISBN : il colle la liste (un numéro par ligne) ou génère une
  // séquence. Chaque numéro est VALIDÉ (13 chiffres + chiffre de contrôle) :
  // erreurs explicites, aucun numéro douteux n'entre. Le numéro reste unique en
  // base (isbn13 unique) — un numéro déjà présent (même attribué) n'est jamais
  // ni écrasé ni dupliqué : il est signalé « déjà en banque ».
  fastify.post("/api/v1/isbn-bank/load", { preHandler: requirePermission("isbn", "administration") }, async (request, reply) => {
    const schema = z.object({
      isbns: z.array(z.string()).min(1).max(5000),
      format: z.nativeEnum(IsbnFormat).optional(),
      observations: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Aucun numéro ISBN à charger." });

    const format = parsed.data.format ?? "print";
    const observations = parsed.data.observations?.trim() || "Chargé par l'administrateur (tranche d'ISBN disponibles).";
    let created = 0;
    const createdList: string[] = [];
    const duplicates: string[] = [];
    const invalid: { value: string; reason: string }[] = [];
    const seen = new Set<string>();

    for (const raw of parsed.data.isbns) {
      const value = raw.trim();
      if (!value) continue; // ligne vide ignorée en silence
      const norm = value.replace(/[^0-9Xx]/g, "").toUpperCase();
      if (norm.length !== 13 || !/^\d{13}$/.test(norm)) {
        invalid.push({ value, reason: `numéro invalide : un ISBN-13 doit comporter exactement 13 chiffres (reçu : ${norm.length || 0}).` });
        continue;
      }
      const expected = computeEan13CheckDigit(norm.slice(0, 12));
      if (Number(norm[12]) !== expected) {
        invalid.push({ value, reason: `chiffre de contrôle erroné (attendu ${expected}, reçu ${norm[12]}) — vérifiez la saisie.` });
        continue;
      }
      if (seen.has(norm)) { duplicates.push(norm); continue; } // doublon dans la liste collée
      seen.add(norm);
      const existing = await prisma.isbn.findFirst({ where: { isbn13: norm }, select: { id: true } });
      if (existing) { duplicates.push(norm); continue; } // déjà en banque → jamais réutilisé
      try {
        await prisma.isbn.create({ data: { isbn13: norm, format, status: "available", observations } });
        created++;
        createdList.push(norm);
      } catch {
        invalid.push({ value, reason: "création impossible (numéro en conflit ?)." });
      }
    }
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "isbn", entityId: "load", newValues: { created, duplicates: duplicates.length, invalid: invalid.length, format }, ipAddress: request.ip });
    return reply.send({ created, created_list: createdList, duplicates: duplicates.length, invalid });
  });

  // ═══ ATTRIBUTION PAR NUMÉRO (Lot 3 — parcours §9 de la spec Banque) ═════════
  // Sur la fiche, à l'étape Attribution des références : l'opérateur SAISIT ou
  // RECHERCHE un numéro ISBN ; Eclospace vérifie la banque et détermine le cas.
  // L'unicité d'un numéro reste garantie par la base (isbn13 unique).
  const normalizeIsbn = (s: string): string => s.replace(/[^0-9Xx]/g, "").toUpperCase();

  // Pré-vérification (affichage du bon message + bonne action côté écran).
  fastify.get("/api/v1/manuscripts/:id/isbn/lookup", { preHandler: requirePermission("isbn", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const raw = String((request.query as { isbn13?: string }).isbn13 ?? "").trim();
    const norm = normalizeIsbn(raw);
    if (!norm) return reply.code(400).send({ code: "validation_error", message: "Saisissez un numéro ISBN." });
    const found = await prisma.isbn.findFirst({
      where: { OR: [{ isbn13: raw }, { isbn13: norm }] },
      include: {
        manuscript: { select: { id: true, title: true, manuscriptNumber: true, workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { firstName: true, lastName: true } } } } } },
      },
    });
    if (!found) return reply.send({ case: "absent", isbn: null, other_manuscript: null });

    const c = found.manuscript?.workContributors?.[0]?.partner;
    const mAuthor = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null : null;
    const info = {
      id: found.id, isbn13: found.isbn13, format: found.format, status: found.status,
      title: found.manuscript?.title ?? found.title ?? null, author: mAuthor ?? found.authorName ?? null,
      assigned_at: found.assignedAt ? found.assignedAt.toISOString() : null,
    };
    const other = found.manuscript && found.manuscript.id !== id
      ? { id: found.manuscript.id, number: found.manuscript.manuscriptNumber, title: found.manuscript.title }
      : null;

    let kase: string;
    if (found.status === "cancelled") kase = "annule";
    else if (found.status === "assigned" || found.status === "published") {
      kase = found.manuscriptId === id ? "attribue_courant" : found.manuscriptId == null ? "attribue_libre" : "attribue_autre";
    } else {
      // available / reserved
      kase = found.manuscriptId && found.manuscriptId !== id ? "attribue_autre" : "disponible";
    }
    return reply.send({ case: kase, isbn: info, other_manuscript: other });
  });

  // Action : attribuer / rattacher / enregistrer-et-attribuer selon le cas.
  fastify.post("/api/v1/manuscripts/:id/isbn/by-number", { preHandler: requirePermission("isbn", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ isbn13: z.string().min(1), format: z.nativeEnum(IsbnFormat).optional(), observations: z.string().max(500).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const norm = normalizeIsbn(parsed.data.isbn13);
    if (!norm) return reply.code(400).send({ code: "validation_error", message: "Numéro ISBN invalide." });

    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });

    const existing = await prisma.isbn.findFirst({ where: { OR: [{ isbn13: parsed.data.isbn13 }, { isbn13: norm }] } });
    const now = new Date();

    // CAS 3 — absent de la banque : on CRÉE l'ISBN (statut attribué) ET on le
    // rattache au manuscrit en cours, en une seule opération.
    if (!existing) {
      const created = await prisma.isbn.create({
        data: { isbn13: norm, format: parsed.data.format ?? "print", status: "assigned", manuscriptId: id, assignedAt: now, assignedBy: request.user!.id, observations: parsed.data.observations ?? null },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "isbn", entityId: created.id, newValues: { manuscriptId: id, isbn13: norm, mode: "register_and_attribute" }, ipAddress: request.ip });
      return reply.code(201).send({ outcome: "registered_and_attributed", isbn: created });
    }

    if (existing.status === "cancelled") {
      return reply.code(409).send({ code: "isbn_cancelled", message: "Cet ISBN est annulé / inutilisable : il ne peut pas être attribué." });
    }
    // Déjà rattaché à CET ouvrage : rien à faire.
    if (existing.manuscriptId === id) {
      return reply.send({ outcome: "already_attached", isbn: existing });
    }
    // Déjà attribué/rattaché à un AUTRE ouvrage : blocage (anti-doublon).
    if (existing.manuscriptId && existing.manuscriptId !== id) {
      const other = await prisma.manuscript.findUnique({ where: { id: existing.manuscriptId }, select: { id: true, title: true, manuscriptNumber: true } });
      return reply.code(409).send({
        code: "isbn_assigned_other",
        message: `Cet ISBN est déjà attribué à « ${other?.title ?? "un autre ouvrage"} »${other ? ` (${other.manuscriptNumber})` : ""}. Il ne peut pas être attribué à un second ouvrage.`,
        other_manuscript: other ? { id: other.id, number: other.manuscriptNumber, title: other.title } : null,
      });
    }
    // CAS 1 (disponible) OU « attribué mais sans ouvrage lié » (déjà paru) :
    // on attribue / rattache l'ISBN existant au manuscrit en cours.
    const wasAttributed = existing.status === "assigned" || existing.status === "published";
    const updated = await prisma.isbn.update({
      where: { id: existing.id },
      data: { manuscriptId: id, status: wasAttributed ? existing.status : "assigned", assignedAt: existing.assignedAt ?? now, assignedBy: existing.assignedBy ?? request.user!.id, observations: parsed.data.observations ?? existing.observations },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "isbn", entityId: updated.id, oldValues: { manuscriptId: existing.manuscriptId, status: existing.status }, newValues: { manuscriptId: id, mode: wasAttributed ? "rattach" : "attribute" }, ipAddress: request.ip });
    return reply.send({ outcome: wasAttributed ? "attached" : "attributed", isbn: updated });
  });

  // Rattacher un ISBN EXISTANT (déjà paru) au manuscrit en cours. Cas : un
  // ouvrage déjà paru au catalogue dont on enregistre/poursuit le dossier dans
  // Eclospace — c'est le même ouvrage, on relie son numéro à ce dossier. Si
  // l'ISBN était rattaché à une autre fiche du même ouvrage, il est transféré
  // (tracé au journal avec l'ancienne fiche). Le numéro reste UNIQUE.
  fastify.post("/api/v1/manuscripts/:id/isbn/:isbnId/rattach", { preHandler: requirePermission("isbn", "saisie") }, async (request, reply) => {
    const { id, isbnId } = request.params as { id: string; isbnId: string };
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const existing = await prisma.isbn.findUnique({ where: { id: isbnId } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "ISBN introuvable." });
    if (existing.status === "cancelled") return reply.code(409).send({ code: "isbn_cancelled", message: "Cet ISBN est annulé / inutilisable : il ne peut pas être rattaché." });
    if (existing.manuscriptId === id) return reply.send({ outcome: "already_attached", isbn: existing });
    const now = new Date();
    const updated = await prisma.isbn.update({
      where: { id: isbnId },
      data: {
        manuscriptId: id,
        status: existing.status === "assigned" || existing.status === "published" ? existing.status : "assigned",
        assignedAt: existing.assignedAt ?? now,
        assignedBy: existing.assignedBy ?? request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "isbn", entityId: isbnId, oldValues: { manuscriptId: existing.manuscriptId }, newValues: { manuscriptId: id, mode: "rattach_existing" }, ipAddress: request.ip });
    return reply.send({ outcome: existing.manuscriptId ? "transferred" : "attached", isbn: updated });
  });

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
          country: body.country,
          depository: body.depository,
          copiesRequired: body.copies_required,
          dueDate: body.due_date === undefined ? undefined : body.due_date ? new Date(body.due_date) : null,
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
        // Volet commercial & financier (undefined = inchangé, null = effacé).
        editionType: body.edition_type,
        pricePublic: body.price_public,
        pricePro: body.price_pro,
        proDiscountPct: body.pro_discount_pct,
        priceEditeur: body.price_editeur,
        editorDiscountPct: body.editor_discount_pct,
        pricePromo: body.price_promo,
        unitProductionCost: body.unit_production_cost,
        commercializationStatus: body.commercialization_status,
        isSchoolBook: body.is_school_book,
        schoolLevel: body.school_level,
        schoolSubject: body.school_subject,
        schoolYear: body.school_year,
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
