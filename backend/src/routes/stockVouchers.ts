import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthorWithdrawalMotive } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

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
}
