import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthorWithdrawalMotive } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { readStoredFile } from "../lib/storage.js";

// Pour chaque ISBN référencé sur un bon de commande, le FICHIER FINAL « bon pour
// impression » = l'intérieur + la couverture du dernier BAT SIGNÉ de l'ouvrage.
// On indique sa disponibilité par ligne (ready) ; le téléchargement passe par
// une route dédiée (droit stock), sans exposer le module manuscrits au magasin.
type PrintMaster = { ready: boolean; signed_at: string | null; has_interior: boolean; has_cover: boolean };
async function printMasterByIsbn(isbnIds: string[]): Promise<Map<string, PrintMaster>> {
  const out = new Map<string, PrintMaster>();
  const ids = [...new Set(isbnIds.filter(Boolean))];
  if (!ids.length) return out;
  const isbns = await prisma.isbn.findMany({ where: { id: { in: ids } }, select: { id: true, manuscriptId: true } });
  const manuscriptIds = [...new Set(isbns.map((i) => i.manuscriptId).filter((v): v is string => !!v))];
  if (!manuscriptIds.length) return out;
  const bats = await prisma.batRecord.findMany({
    where: { manuscriptId: { in: manuscriptIds }, status: "signed" },
    orderBy: { cycleNumber: "desc" },
    select: { manuscriptId: true, interiorVersionId: true, coverVersionId: true, signatures: { orderBy: { signedAt: "desc" }, take: 1, select: { signedAt: true } } },
  });
  const batByManuscript = new Map<string, (typeof bats)[number]>();
  for (const b of bats) if (!batByManuscript.has(b.manuscriptId)) batByManuscript.set(b.manuscriptId, b);
  for (const isbn of isbns) {
    if (!isbn.manuscriptId) continue;
    const b = batByManuscript.get(isbn.manuscriptId);
    if (b) out.set(isbn.id, { ready: true, signed_at: b.signatures[0]?.signedAt?.toISOString() ?? null, has_interior: !!b.interiorVersionId, has_cover: !!b.coverVersionId });
  }
  return out;
}
// Enrichit un bon de commande : chaque ligne reçoit `print_master` (null si pas
// d'ISBN ou pas de BAT signé).
async function withPrintMaster<T extends { lines: { isbnId: string | null }[] }>(voucher: T): Promise<T> {
  const map = await printMasterByIsbn(voucher.lines.map((l) => l.isbnId ?? "").filter(Boolean));
  return { ...voucher, lines: voucher.lines.map((l) => ({ ...l, print_master: l.isbnId ? map.get(l.isbnId) ?? null : null })) };
}

// Pièces officielles du pôle Stock & magasin (revue opérateur du 27/08/2026) :
// Bon de réception de livres + Retrait d'ouvrage auteur. Ce sont des DOCUMENTS
// numérotés, tracés et réimprimables ; ils n'affectent PAS les quantités en
// stock ni le compte auteur (décision opérateur : « document seul »).

// Numérotation atomique continue par année (même mécanisme que les contrats).
async function nextBookReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO book_receipt_counters (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = book_receipt_counters.last_value + 1
    RETURNING last_value`;
  return `BR-${year}-${String(rows[0].last_value).padStart(4, "0")}`;
}

async function nextWithdrawalNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO author_withdrawal_counters (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = author_withdrawal_counters.last_value + 1
    RETURNING last_value`;
  return `RA-${year}-${String(rows[0].last_value).padStart(4, "0")}`;
}

// Bon de commande fournisseur / imprimeur : BC-AAAA-NNNN (compteur annuel atomique).
async function nextPurchaseOrderVoucherNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO purchase_order_voucher_counters (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = purchase_order_voucher_counters.last_value + 1
    RETURNING last_value`;
  return `BC-${year}-${String(rows[0].last_value).padStart(4, "0")}`;
}

const lineSchema = z.object({
  isbn_id: z.string().uuid().nullish(),
  title: z.string().min(1).max(300),
  author: z.string().max(200).nullish(),
  qty_ordered: z.number().int().min(0).nullish(),
  qty_received: z.number().int().min(0).nullish(),
  qty_good: z.number().int().min(0).nullish(),
  qty_damaged: z.number().int().min(0).nullish(),
});

const receiptSchema = z.object({
  received_at: z.coerce.date(),
  supplier: z.string().max(300).nullish(),
  order_number: z.string().max(120).nullish(),
  delivery_note: z.string().max(120).nullish(),
  carrier: z.string().max(200).nullish(),
  received_by_name: z.string().max(200).nullish(),
  received_by_role: z.string().max(200).nullish(),
  remarks: z.string().max(4000).nullish(),
  lines: z.array(lineSchema).min(1),
});

const withdrawalSchema = z.object({
  issued_at: z.coerce.date(),
  place: z.string().max(200).nullish(),
  author_name: z.string().min(1).max(200),
  author_address: z.string().max(300).nullish(),
  author_phone: z.string().max(80).nullish(),
  author_email: z.string().max(200).nullish(),
  work_title: z.string().min(1).max(300),
  isbn_id: z.string().uuid().nullish(),
  quantity: z.number().int().min(1),
  motive: z.nativeEnum(AuthorWithdrawalMotive),
  motive_other: z.string().max(500).nullish(),
});

const poLineSchema = z.object({
  isbn_id: z.string().uuid().nullish(),
  designation: z.string().min(1).max(300),
  specs: z.string().max(500).nullish(),
  quantity: z.number().int().min(1),
  unit_price_ht: z.number().min(0),
});

const purchaseOrderSchema = z.object({
  ordered_at: z.coerce.date(),
  supplier: z.string().min(1).max(300),
  supplier_address: z.string().max(400).nullish(),
  supplier_contact: z.string().max(300).nullish(),
  quote_ref: z.string().max(120).nullish(),
  delivery_place: z.string().max(300).nullish(),
  delivery_due: z.coerce.date().nullish(),
  payment_terms: z.string().max(400).nullish(),
  currency: z.string().max(8).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  issued_by_name: z.string().max(200).nullish(),
  issued_by_role: z.string().max(200).nullish(),
  notes: z.string().max(4000).nullish(),
  lines: z.array(poLineSchema).min(1),
});

function purchaseOrderData(d: z.infer<typeof purchaseOrderSchema>) {
  return {
    orderedAt: d.ordered_at,
    supplier: d.supplier.trim(),
    supplierAddress: d.supplier_address?.trim() || null,
    supplierContact: d.supplier_contact?.trim() || null,
    quoteRef: d.quote_ref?.trim() || null,
    deliveryPlace: d.delivery_place?.trim() || null,
    deliveryDue: d.delivery_due ?? null,
    paymentTerms: d.payment_terms?.trim() || null,
    currency: d.currency?.trim() || "XAF",
    taxRate: d.tax_rate ?? 0,
    issuedByName: d.issued_by_name?.trim() || null,
    issuedByRole: d.issued_by_role?.trim() || null,
    notes: d.notes?.trim() || null,
  };
}

function poLineData(l: z.infer<typeof poLineSchema>, position: number) {
  return {
    isbnId: l.isbn_id ?? null,
    designation: l.designation.trim(),
    specs: l.specs?.trim() || null,
    quantity: l.quantity,
    unitPriceHt: l.unit_price_ht,
    position,
  };
}

function lineData(l: z.infer<typeof lineSchema>, position: number) {
  return {
    isbnId: l.isbn_id ?? null,
    title: l.title.trim(),
    author: l.author?.trim() || null,
    qtyOrdered: l.qty_ordered ?? null,
    qtyReceived: l.qty_received ?? null,
    qtyGood: l.qty_good ?? null,
    qtyDamaged: l.qty_damaged ?? null,
    position,
  };
}

export default async function stockVoucherRoutes(fastify: FastifyInstance) {
  // === Bon de réception de livres ===
  fastify.get("/api/v1/book-receipts", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const rows = await prisma.bookReceiptVoucher.findMany({
      where: { deletedAt: null },
      orderBy: { receivedAt: "desc" },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    return reply.send(rows);
  });

  fastify.get("/api/v1/book-receipts/:id", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.bookReceiptVoucher.findFirst({ where: { id, deletedAt: null }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!row) return reply.code(404).send({ code: "not_found", message: "Bon de réception introuvable." });
    return reply.send(row);
  });

  fastify.post("/api/v1/book-receipts", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = receiptSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const d = parsed.data;
    const number = await nextBookReceiptNumber();
    const created = await prisma.bookReceiptVoucher.create({
      data: {
        number,
        receivedAt: d.received_at,
        supplier: d.supplier?.trim() || null,
        orderNumber: d.order_number?.trim() || null,
        deliveryNote: d.delivery_note?.trim() || null,
        carrier: d.carrier?.trim() || null,
        receivedByName: d.received_by_name?.trim() || null,
        receivedByRole: d.received_by_role?.trim() || null,
        remarks: d.remarks?.trim() || null,
        createdById: request.user!.id,
        lines: { create: d.lines.map((l, i) => lineData(l, i)) },
      },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "book_receipt_voucher", entityId: created.id, newValues: { number }, ipAddress: request.ip });
    return reply.code(201).send(created);
  });

  fastify.put("/api/v1/book-receipts/:id", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = receiptSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const existing = await prisma.bookReceiptVoucher.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Bon de réception introuvable." });
    const d = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.bookReceiptLine.deleteMany({ where: { voucherId: id } });
      return tx.bookReceiptVoucher.update({
        where: { id },
        data: {
          receivedAt: d.received_at,
          supplier: d.supplier?.trim() || null,
          orderNumber: d.order_number?.trim() || null,
          deliveryNote: d.delivery_note?.trim() || null,
          carrier: d.carrier?.trim() || null,
          receivedByName: d.received_by_name?.trim() || null,
          receivedByRole: d.received_by_role?.trim() || null,
          remarks: d.remarks?.trim() || null,
          lines: { create: d.lines.map((l, i) => lineData(l, i)) },
        },
        include: { lines: { orderBy: { position: "asc" } } },
      });
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "book_receipt_voucher", entityId: id, ipAddress: request.ip });
    return reply.send(updated);
  });

  fastify.delete("/api/v1/book-receipts/:id", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.bookReceiptVoucher.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Bon de réception introuvable." });
    await prisma.bookReceiptVoucher.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "book_receipt_voucher", entityId: id, newValues: { deleted: true }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // === Retrait d'ouvrage auteur ===
  fastify.get("/api/v1/author-withdrawals", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const rows = await prisma.authorWithdrawalVoucher.findMany({ where: { deletedAt: null }, orderBy: { issuedAt: "desc" } });
    return reply.send(rows);
  });

  fastify.get("/api/v1/author-withdrawals/:id", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.authorWithdrawalVoucher.findFirst({ where: { id, deletedAt: null } });
    if (!row) return reply.code(404).send({ code: "not_found", message: "Retrait d'ouvrage introuvable." });
    return reply.send(row);
  });

  fastify.post("/api/v1/author-withdrawals", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = withdrawalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const d = parsed.data;
    if (d.motive === "autre" && !d.motive_other?.trim()) {
      return reply.code(400).send({ code: "motive_other_required", message: "Précisez le motif « Autre »." });
    }
    const number = await nextWithdrawalNumber();
    const created = await prisma.authorWithdrawalVoucher.create({
      data: {
        number,
        issuedAt: d.issued_at,
        place: d.place?.trim() || null,
        authorName: d.author_name.trim(),
        authorAddress: d.author_address?.trim() || null,
        authorPhone: d.author_phone?.trim() || null,
        authorEmail: d.author_email?.trim() || null,
        workTitle: d.work_title.trim(),
        isbnId: d.isbn_id ?? null,
        quantity: d.quantity,
        motive: d.motive,
        motiveOther: d.motive === "autre" ? d.motive_other?.trim() ?? null : null,
        createdById: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "author_withdrawal_voucher", entityId: created.id, newValues: { number }, ipAddress: request.ip });
    return reply.code(201).send(created);
  });

  fastify.put("/api/v1/author-withdrawals/:id", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = withdrawalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const existing = await prisma.authorWithdrawalVoucher.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Retrait d'ouvrage introuvable." });
    const d = parsed.data;
    if (d.motive === "autre" && !d.motive_other?.trim()) {
      return reply.code(400).send({ code: "motive_other_required", message: "Précisez le motif « Autre »." });
    }
    const updated = await prisma.authorWithdrawalVoucher.update({
      where: { id },
      data: {
        issuedAt: d.issued_at,
        place: d.place?.trim() || null,
        authorName: d.author_name.trim(),
        authorAddress: d.author_address?.trim() || null,
        authorPhone: d.author_phone?.trim() || null,
        authorEmail: d.author_email?.trim() || null,
        workTitle: d.work_title.trim(),
        isbnId: d.isbn_id ?? null,
        quantity: d.quantity,
        motive: d.motive,
        motiveOther: d.motive === "autre" ? d.motive_other?.trim() ?? null : null,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "author_withdrawal_voucher", entityId: id, ipAddress: request.ip });
    return reply.send(updated);
  });

  fastify.delete("/api/v1/author-withdrawals/:id", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.authorWithdrawalVoucher.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Retrait d'ouvrage introuvable." });
    await prisma.authorWithdrawalVoucher.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "author_withdrawal_voucher", entityId: id, newValues: { deleted: true }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // === Bon de commande (fournisseur / imprimeur) ===
  fastify.get("/api/v1/purchase-order-vouchers", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const rows = await prisma.purchaseOrderVoucher.findMany({
      where: { deletedAt: null },
      orderBy: { orderedAt: "desc" },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    return reply.send(await Promise.all(rows.map(withPrintMaster)));
  });

  fastify.get("/api/v1/purchase-order-vouchers/:id", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.purchaseOrderVoucher.findFirst({ where: { id, deletedAt: null }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!row) return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
    return reply.send(await withPrintMaster(row));
  });

  // Téléchargement du FICHIER FINAL « bon pour impression » (intérieur ou
  // couverture du BAT signé) d'une ligne du bon de commande — accessible au
  // magasin (stock:consultation), sans ouvrir le module manuscrits.
  fastify.get("/api/v1/purchase-order-vouchers/:id/lines/:lineId/print-file/:which", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { id, lineId, which } = request.params as { id: string; lineId: string; which: string };
    if (which !== "interior" && which !== "cover") return reply.code(400).send({ code: "validation_error", message: "Type de fichier invalide." });
    const line = await prisma.purchaseOrderVoucherLine.findFirst({ where: { id: lineId, voucherId: id }, select: { isbnId: true } });
    if (!line?.isbnId) return reply.code(404).send({ code: "not_found", message: "Ligne ou ouvrage introuvable." });
    const isbn = await prisma.isbn.findUnique({ where: { id: line.isbnId }, select: { manuscriptId: true } });
    if (!isbn?.manuscriptId) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });
    const bat = await prisma.batRecord.findFirst({ where: { manuscriptId: isbn.manuscriptId, status: "signed" }, orderBy: { cycleNumber: "desc" }, select: { interiorVersionId: true, coverVersionId: true } });
    const versionId = which === "interior" ? bat?.interiorVersionId : bat?.coverVersionId;
    if (!versionId) return reply.code(404).send({ code: "not_found", message: "Fichier final non disponible (BAT non signé)." });
    const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
    if (!version) return reply.code(404).send({ code: "not_found", message: "Fichier introuvable." });
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  fastify.post("/api/v1/purchase-order-vouchers", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = purchaseOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const d = parsed.data;
    const number = await nextPurchaseOrderVoucherNumber();
    const created = await prisma.purchaseOrderVoucher.create({
      data: { number, ...purchaseOrderData(d), createdById: request.user!.id, lines: { create: d.lines.map((l, i) => poLineData(l, i)) } },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "purchase_order_voucher", entityId: created.id, newValues: { number }, ipAddress: request.ip });
    return reply.code(201).send(created);
  });

  fastify.put("/api/v1/purchase-order-vouchers/:id", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = purchaseOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const existing = await prisma.purchaseOrderVoucher.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
    const d = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderVoucherLine.deleteMany({ where: { voucherId: id } });
      return tx.purchaseOrderVoucher.update({
        where: { id },
        data: { ...purchaseOrderData(d), lines: { create: d.lines.map((l, i) => poLineData(l, i)) } },
        include: { lines: { orderBy: { position: "asc" } } },
      });
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "purchase_order_voucher", entityId: id, ipAddress: request.ip });
    return reply.send(updated);
  });

  fastify.delete("/api/v1/purchase-order-vouchers/:id", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.purchaseOrderVoucher.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
    await prisma.purchaseOrderVoucher.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "purchase_order_voucher", entityId: id, newValues: { deleted: true }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });
}
