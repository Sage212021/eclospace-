import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthorReceiptType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextReceiptNumber } from "../lib/receiptNumber.js";

// PAIEMENTS AUTEURS & REÇUS (chantier 25/09/2026) — incrément 1 (socle).
// Le reçu est l'OPÉRATION FINANCIÈRE CENTRALE (source unique) : l'éditorial
// l'enregistre, la finance le voit et l'exploitera (mêmes données, aucune
// ressaisie). Immuable : numéro infalsifiable, traçabilité de l'initiateur figée,
// jamais de suppression (annulation tracée — incrément suivant).

const num = (v: unknown) => Number(v as number);

// Résout des identifiants d'utilisateurs en { nom, profil, pôle } pour la
// section « Traçabilité de l'opération » (qui a fait quoi).
async function resolveActors(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (uniq.length === 0) return new Map<string, { name: string; role: string | null; dept: string | null }>();
  const users = await prisma.user.findMany({
    where: { id: { in: uniq } },
    select: { id: true, username: true, userRoles: { where: { revokedAt: null }, take: 1, select: { role: { select: { label: true, department: { select: { name: true } } } } } } },
  });
  return new Map(users.map((u) => [u.id, { name: u.username, role: u.userRoles[0]?.role.label ?? null, dept: u.userRoles[0]?.role.department?.name ?? null }]));
}

function primaryAuthor(m: { workContributors: { partner: { id: string; firstName: string; lastName: string; phone: string | null } }[] }) {
  const c = m.workContributors[0];
  return c ? { id: c.partner.id, name: `${c.partner.firstName} ${c.partner.lastName}`.trim(), phone: c.partner.phone } : null;
}

const createSchema = z.object({
  manuscript_id: z.string().uuid(),
  // Auteur : par défaut l'auteur principal du manuscrit (auto-rempli). On accepte
  // un partner_id explicite (co-auteur) à condition qu'il soit contributeur du manuscrit.
  partner_id: z.string().uuid().optional(),
  type: z.nativeEnum(AuthorReceiptType),
  service_label: z.string().max(200).optional(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(8).default("XAF"),
  method: z.string().min(1).max(60),
  paid_at: z.string().min(4), // date effective du paiement (ISO ou AAAA-MM-JJ)
  tx_reference: z.string().max(200).optional(),
  comment: z.string().max(2000).optional(),
});

export default async function authorReceiptRoutes(fastify: FastifyInstance) {
  // — Données du formulaire —
  fastify.get("/api/v1/author-receipts/form/methods", { preHandler: requirePermission("paiements_auteurs", "consultation") }, async (_request, reply) => {
    const methods = await prisma.paymentMethodDef.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, label: true } });
    return reply.send(methods);
  });

  // Recherche de manuscrit pour le formulaire (auto-remplissage auteur/référence/titre).
  fastify.get("/api/v1/author-receipts/form/manuscripts", { preHandler: requirePermission("paiements_auteurs", "consultation") }, async (request, reply) => {
    const q = (request.query as { q?: string }).q?.trim() ?? "";
    const manuscripts = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        ...(q
          ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { manuscriptNumber: { contains: q, mode: "insensitive" } }, { workContributors: { some: { partner: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } } }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true, manuscriptNumber: true, title: true,
        collection: { select: { label: true } },
        workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { id: true, firstName: true, lastName: true, phone: true } } } },
      },
    });
    return reply.send(manuscripts.map((m) => ({ id: m.id, manuscript_number: m.manuscriptNumber, title: m.title, collection: m.collection?.label ?? null, author: primaryAuthor(m) })));
  });

  // — Enregistrer un paiement / émettre un reçu —
  fastify.post("/api/v1/author-receipts", { preHandler: requirePermission("paiements_auteurs", "saisie") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs obligatoires manquants ou invalides.", details: parsed.error.issues });
    const b = parsed.data;

    // Prestation éditoriale : le libellé de la prestation est obligatoire.
    if (b.type === "prestation_editoriale" && !b.service_label?.trim()) {
      return reply.code(400).send({ code: "service_required", message: "Précisez la prestation éditoriale concernée." });
    }
    // Mode de paiement valide (configuré et actif).
    const method = await prisma.paymentMethodDef.findFirst({ where: { code: b.method, active: true }, select: { code: true } });
    if (!method) return reply.code(400).send({ code: "invalid_method", message: "Mode de paiement inconnu ou désactivé." });

    const manuscript = await prisma.manuscript.findFirst({
      where: { id: b.manuscript_id, deletedAt: null },
      select: { id: true, workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, select: { partnerId: true } } },
    });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });

    // Auteur : explicite (doit être contributeur) ou auteur principal du manuscrit.
    const contributorIds = new Set(manuscript.workContributors.map((c) => c.partnerId));
    let partnerId = b.partner_id ?? manuscript.workContributors[0]?.partnerId ?? null;
    if (b.partner_id && !contributorIds.has(b.partner_id)) {
      return reply.code(400).send({ code: "author_mismatch", message: "L'auteur choisi n'est pas rattaché à ce manuscrit." });
    }
    if (!partnerId) return reply.code(409).send({ code: "no_author", message: "Ce manuscrit n'a pas d'auteur enregistré : complétez sa fiche avant d'émettre un reçu." });

    const paidAt = new Date(b.paid_at);
    if (Number.isNaN(paidAt.getTime())) return reply.code(400).send({ code: "invalid_date", message: "Date de paiement invalide." });

    const me = request.user!.id;
    const now = new Date();
    const receiptNumber = await nextReceiptNumber();
    const receipt = await prisma.authorReceipt.create({
      data: {
        receiptNumber,
        type: b.type,
        status: "enregistre",
        partnerId,
        manuscriptId: manuscript.id,
        serviceLabel: b.type === "prestation_editoriale" ? b.service_label!.trim() : null,
        amount: b.amount,
        currency: b.currency,
        method: b.method,
        paidAt,
        txReference: b.tx_reference?.trim() || null,
        comment: b.comment?.trim() || null,
        initiatedBy: me,
        initiatedAt: now,
        generatedBy: me,
        generatedAt: now,
      },
    });
    await writeAuditLog({ userId: me, action: "create", entityType: "author_receipt", entityId: receipt.id, newValues: { receiptNumber, type: b.type, amount: b.amount, partnerId, manuscriptId: manuscript.id }, ipAddress: request.ip });
    return reply.code(201).send({ id: receipt.id, receipt_number: receiptNumber });
  });

  // — Liste (Éditorial ET Finance : même donnée, filtres métier) —
  fastify.get("/api/v1/author-receipts", { preHandler: requirePermission("paiements_auteurs", "consultation") }, async (request, reply) => {
    const q = request.query as { from?: string; to?: string; partner_id?: string; manuscript_id?: string; type?: string; method?: string; status?: string; q?: string };
    const paidAt: { gte?: Date; lte?: Date } = {};
    if (q.from) { const d = new Date(q.from); if (!Number.isNaN(d.getTime())) paidAt.gte = d; }
    if (q.to) { const d = new Date(q.to); if (!Number.isNaN(d.getTime())) { d.setUTCHours(23, 59, 59, 999); paidAt.lte = d; } }
    const text = q.q?.trim();
    const rows = await prisma.authorReceipt.findMany({
      where: {
        ...(paidAt.gte || paidAt.lte ? { paidAt } : {}),
        ...(q.partner_id ? { partnerId: q.partner_id } : {}),
        ...(q.manuscript_id ? { manuscriptId: q.manuscript_id } : {}),
        ...(q.type ? { type: q.type as AuthorReceiptType } : {}),
        ...(q.method ? { method: q.method } : {}),
        ...(q.status ? { status: q.status as never } : {}),
        ...(text ? { OR: [
          { receiptNumber: { contains: text, mode: "insensitive" } },
          { txReference: { contains: text, mode: "insensitive" } },
          { partner: { OR: [{ firstName: { contains: text, mode: "insensitive" } }, { lastName: { contains: text, mode: "insensitive" } }] } },
          { manuscript: { OR: [{ title: { contains: text, mode: "insensitive" } }, { manuscriptNumber: { contains: text, mode: "insensitive" } }] } },
        ] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true, receiptNumber: true, type: true, status: true, serviceLabel: true, amount: true, currency: true, method: true, paidAt: true, createdAt: true, initiatedBy: true,
        partner: { select: { firstName: true, lastName: true } },
        manuscript: { select: { manuscriptNumber: true, title: true } },
      },
    });
    const actors = await resolveActors(rows.map((r) => r.initiatedBy));
    const methods = new Map((await prisma.paymentMethodDef.findMany({ select: { code: true, label: true } })).map((m) => [m.code, m.label]));
    return reply.send(rows.map((r) => ({
      id: r.id, receipt_number: r.receiptNumber, type: r.type, status: r.status,
      author: r.partner ? `${r.partner.firstName} ${r.partner.lastName}`.trim() : "—",
      manuscript: r.manuscript ? r.manuscript.title : null,
      manuscript_number: r.manuscript?.manuscriptNumber ?? null,
      service_label: r.serviceLabel,
      amount: num(r.amount), currency: r.currency,
      method: r.method, method_label: methods.get(r.method) ?? r.method,
      paid_at: r.paidAt.toISOString(),
      created_at: r.createdAt.toISOString(),
      registered_by: r.initiatedBy ? actors.get(r.initiatedBy)?.name ?? null : null,
    })));
  });

  // — Détail + traçabilité complète (pour la fiche reçu et le PDF) —
  fastify.get("/api/v1/author-receipts/:id", { preHandler: requirePermission("paiements_auteurs", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await prisma.authorReceipt.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, address: true, niu: true } },
        manuscript: { select: { id: true, manuscriptNumber: true, title: true, collection: { select: { label: true } } } },
      },
    });
    if (!r) return reply.code(404).send({ code: "not_found", message: "Reçu introuvable." });
    const methods = new Map((await prisma.paymentMethodDef.findMany({ select: { code: true, label: true } })).map((m) => [m.code, m.label]));
    const actors = await resolveActors([r.initiatedBy, r.generatedBy, r.controlledBy, r.accountedBy, r.cancelledBy]);
    const actor = (uid: string | null, at: Date | null) => uid ? { name: actors.get(uid)?.name ?? null, role: actors.get(uid)?.role ?? null, dept: actors.get(uid)?.dept ?? null, at: at?.toISOString() ?? null } : null;
    return reply.send({
      id: r.id, receipt_number: r.receiptNumber, type: r.type, status: r.status,
      service_label: r.serviceLabel,
      amount: num(r.amount), currency: r.currency,
      method: r.method, method_label: methods.get(r.method) ?? r.method,
      paid_at: r.paidAt.toISOString(), tx_reference: r.txReference, comment: r.comment,
      accounting_ref: r.accountingRef,
      author: { id: r.partner.id, name: `${r.partner.firstName} ${r.partner.lastName}`.trim(), phone: r.partner.phone, email: r.partner.email, address: r.partner.address, niu: r.partner.niu },
      manuscript: r.manuscript ? { id: r.manuscript.id, number: r.manuscript.manuscriptNumber, title: r.manuscript.title, collection: r.manuscript.collection?.label ?? null } : null,
      traceability: {
        initiated: actor(r.initiatedBy, r.initiatedAt),
        generated: actor(r.generatedBy, r.generatedAt),
        controlled: actor(r.controlledBy, r.controlledAt),
        accounted: actor(r.accountedBy, r.accountedAt),
        cancelled: actor(r.cancelledBy, r.cancelledAt),
        cancel_reason: r.cancelReason,
      },
      created_at: r.createdAt.toISOString(),
    });
  });

  // — Circuit Finance : contrôle puis intégration comptable (séparation des
  // fonctions). Réservé à la finance (validation). Un reçu annulé n'évolue plus ;
  // l'intégration comptable exige un reçu préalablement contrôlé. Chaque étape
  // fige son acteur et son horodatage, et est tracée au journal d'audit.
  fastify.post("/api/v1/author-receipts/:id/control", { preHandler: requirePermission("paiements_auteurs", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await prisma.authorReceipt.findUnique({ where: { id }, select: { status: true } });
    if (!r) return reply.code(404).send({ code: "not_found", message: "Reçu introuvable." });
    if (r.status === "annule") return reply.code(409).send({ code: "receipt_cancelled", message: "Ce reçu est annulé : il n'évolue plus." });
    if (r.status === "comptabilise") return reply.code(409).send({ code: "already_accounted", message: "Ce reçu est déjà intégré en comptabilité." });
    const me = request.user!.id;
    await prisma.authorReceipt.update({ where: { id }, data: { status: "controle", controlledBy: me, controlledAt: new Date() } });
    await writeAuditLog({ userId: me, action: "update", entityType: "author_receipt", entityId: id, newValues: { status: "controle" }, ipAddress: request.ip });
    return reply.send({ id, status: "controle" });
  });

  const accountSchema = z.object({ accounting_ref: z.string().max(120).optional() });
  fastify.post("/api/v1/author-receipts/:id/account", { preHandler: requirePermission("paiements_auteurs", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = accountSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Référence comptable invalide." });
    const r = await prisma.authorReceipt.findUnique({ where: { id }, select: { status: true } });
    if (!r) return reply.code(404).send({ code: "not_found", message: "Reçu introuvable." });
    if (r.status === "annule") return reply.code(409).send({ code: "receipt_cancelled", message: "Ce reçu est annulé : il n'évolue plus." });
    if (r.status !== "controle") return reply.code(409).send({ code: "not_controlled", message: "Contrôlez d'abord le reçu avant de l'intégrer en comptabilité." });
    const me = request.user!.id;
    await prisma.authorReceipt.update({ where: { id }, data: { status: "comptabilise", accountedBy: me, accountedAt: new Date(), accountingRef: parsed.data.accounting_ref?.trim() || null } });
    await writeAuditLog({ userId: me, action: "update", entityType: "author_receipt", entityId: id, newValues: { status: "comptabilise", accountingRef: parsed.data.accounting_ref ?? null }, ipAddress: request.ip });
    return reply.send({ id, status: "comptabilise" });
  });

  // — États / tableaux de bord : agrégats sur le périmètre filtré (par type, par
  // mode, total). Les montants sont calculés sur les opérations réellement
  // enregistrées, hors reçus annulés.
  fastify.get("/api/v1/author-receipts/stats", { preHandler: requirePermission("paiements_auteurs", "consultation") }, async (request, reply) => {
    const q = request.query as { from?: string; to?: string; type?: string; method?: string };
    const paidAt: { gte?: Date; lte?: Date } = {};
    if (q.from) { const d = new Date(q.from); if (!Number.isNaN(d.getTime())) paidAt.gte = d; }
    if (q.to) { const d = new Date(q.to); if (!Number.isNaN(d.getTime())) { d.setUTCHours(23, 59, 59, 999); paidAt.lte = d; } }
    const where = {
      status: { not: "annule" as const },
      ...(paidAt.gte || paidAt.lte ? { paidAt } : {}),
      ...(q.type ? { type: q.type as AuthorReceiptType } : {}),
      ...(q.method ? { method: q.method } : {}),
    };
    const rows = await prisma.authorReceipt.findMany({ where, select: { type: true, method: true, status: true, amount: true } });
    const methods = new Map((await prisma.paymentMethodDef.findMany({ select: { code: true, label: true } })).map((m) => [m.code, m.label]));
    const sumBy = (key: (r: (typeof rows)[number]) => string, label?: (k: string) => string) => {
      const m = new Map<string, { amount: number; count: number }>();
      for (const r of rows) { const k = key(r); const c = m.get(k) ?? { amount: 0, count: 0 }; c.amount += num(r.amount); c.count += 1; m.set(k, c); }
      return [...m.entries()].map(([k, v]) => ({ key: k, label: label ? label(k) : k, amount: v.amount, count: v.count })).sort((a, b) => b.amount - a.amount);
    };
    const TYPE_LABEL: Record<string, string> = { frais_depot: "Frais de dépôt (évaluation)", prestation_editoriale: "Prestations éditoriales" };
    return reply.send({
      total_amount: rows.reduce((s, r) => s + num(r.amount), 0),
      count: rows.length,
      by_type: sumBy((r) => r.type, (k) => TYPE_LABEL[k] ?? k),
      by_method: sumBy((r) => r.method, (k) => methods.get(k) ?? k),
    });
  });
}
