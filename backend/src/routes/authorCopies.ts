import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthorCopyCategory } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { adjustStockItem } from "../lib/stock.js";

// Compte auteur (§14) — registre 5. On distingue toujours « exemplaires dus »
// (droit contractuel) et « exemplaires effectivement remis ». Chaque remise crée
// une entrée append-only ET le mouvement de stock author_copy correspondant.

const CATEGORY_LABELS: Record<AuthorCopyCategory, string> = {
  contractuel: "Au titre du contrat",
  gratuit: "Gratuit",
  promotionnel: "Promotionnel",
  evenement: "Événement",
  achete: "Acheté",
  autre: "Autre",
};

const recordSchema = z.object({
  partner_id: z.string().uuid(),
  isbn_id: z.string().uuid(),
  contract_id: z.string().uuid().optional(),
  category: z.nativeEnum(AuthorCopyCategory),
  quantity: z.number().int().positive(),
  from_location_id: z.string().uuid(),
  print_run: z.number().int().nonnegative().default(0),
  note: z.string().max(300).optional(),
});

const entitlementSchema = z.object({ author_free_copies: z.number().int().nonnegative().nullable() });

// Agrège les entrées d'un compte auteur (par contrat, ou par auteur + ouvrage).
async function accountReport(where: { contractId?: string; partnerId?: string; isbnId?: string }) {
  const entries = await prisma.authorCopyEntry.findMany({
    where: {
      ...(where.contractId ? { contractId: where.contractId } : {}),
      ...(where.partnerId ? { partnerId: where.partnerId } : {}),
      ...(where.isbnId ? { isbnId: where.isbnId } : {}),
    },
    orderBy: { deliveredAt: "desc" },
  });
  const byCategory: Record<string, number> = { contractuel: 0, gratuit: 0, promotionnel: 0, evenement: 0, achete: 0, autre: 0 };
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] ?? 0) + e.quantity;
  const remisTotal = entries.reduce((s, e) => s + e.quantity, 0);
  return { entries, by_category: byCategory, remis_total: remisTotal, remis_contractuel: byCategory.contractuel };
}

export default async function authorCopyRoutes(fastify: FastifyInstance) {
  const canView = requireAnyPermission([
    { module: "contracts", action: "consultation" },
    { module: "direction", action: "consultation" },
    { module: "isbn", action: "consultation" },
    { module: "stock", action: "consultation" },
  ]);

  // Compte auteur d'un contrat : exemplaires dus, remis (par catégorie), encore dus.
  fastify.get("/api/v1/author-copies/account", { preHandler: canView }, async (request, reply) => {
    const q = request.query as { contract_id?: string; partner_id?: string; isbn_id?: string };
    let dus: number | null = null;
    if (q.contract_id) {
      const terms = await prisma.royaltyTerms.findUnique({ where: { contractId: q.contract_id } });
      dus = terms?.authorFreeCopies ?? null;
    }
    const report = await accountReport({ contractId: q.contract_id, partnerId: q.partner_id, isbnId: q.isbn_id });
    const encoreDus = dus === null ? null : Math.max(0, dus - report.remis_contractuel);
    return reply.send({
      author_free_copies: dus,
      encore_dus: encoreDus,
      remis_total: report.remis_total,
      remis_contractuel: report.remis_contractuel,
      by_category: report.by_category,
      entries: report.entries.map((e) => ({
        id: e.id,
        category: e.category,
        category_label: CATEGORY_LABELS[e.category],
        quantity: e.quantity,
        note: e.note,
        delivered_at: e.deliveredAt,
      })),
    });
  });

  // Fixer/mettre à jour les exemplaires DUS au titre d'un contrat. Autorisé même
  // sur un contrat actif : c'est un droit contractuel, pas une clause financière.
  fastify.patch("/api/v1/contracts/:id/author-free-copies", { preHandler: requirePermission("contracts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = entitlementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const contract = await prisma.contract.findFirst({ where: { id, deletedAt: null } });
    if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
    await prisma.royaltyTerms.upsert({
      where: { contractId: id },
      update: { authorFreeCopies: parsed.data.author_free_copies },
      create: { contractId: id, base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }], authorFreeCopies: parsed.data.author_free_copies },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "royalty_terms", entityId: id, newValues: { authorFreeCopies: parsed.data.author_free_copies }, ipAddress: request.ip });
    return reply.send({ author_free_copies: parsed.data.author_free_copies });
  });

  // Enregistrer une remise effective d'exemplaires à l'auteur (décrémente le
  // stock via un mouvement author_copy, dans une même transaction).
  fastify.post("/api/v1/author-copies", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = recordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const b = parsed.data;
    const partner = await prisma.partner.findUnique({ where: { id: b.partner_id } });
    if (!partner) return reply.code(404).send({ code: "not_found", message: "Auteur introuvable." });

    try {
      const entry = await prisma.$transaction(async (tx) => {
        const debited = await adjustStockItem(tx, b.isbn_id, b.from_location_id, b.print_run, -b.quantity, 0, "vendable");
        if (debited.quantityPhysical < 0) throw new Error("stock_negative");
        const movement = await tx.stockMovement.create({
          data: { type: "author_copy", isbnId: b.isbn_id, printRun: b.print_run, fromLocationId: b.from_location_id, quantity: b.quantity, reason: `Compte auteur — ${CATEGORY_LABELS[b.category]}${b.note ? ` (${b.note})` : ""}`, status: "completed", condition: "vendable", movedBy: request.user!.id },
        });
        return tx.authorCopyEntry.create({
          data: { partnerId: b.partner_id, isbnId: b.isbn_id, contractId: b.contract_id, category: b.category, quantity: b.quantity, note: b.note, stockMovementId: movement.id, recordedBy: request.user!.id },
        });
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "author_copy_entry", entityId: entry.id, newValues: { partnerId: b.partner_id, isbnId: b.isbn_id, category: b.category, quantity: b.quantity }, ipAddress: request.ip });
      return reply.code(201).send(entry);
    } catch (e) {
      if (e instanceof Error && e.message === "stock_negative") {
        return reply.code(409).send({ code: "stock_negative", message: `Remise impossible : le stock ne détient pas ${b.quantity} exemplaire(s) disponible(s) à ce lieu.` });
      }
      throw e;
    }
  });
}
