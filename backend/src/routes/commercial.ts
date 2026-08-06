import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CustomerCategory, SalesChannel, SalesOrderStatus, PosPaymentMethod, ReturnLineVerdict, ShippingZone } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyRole } from "../lib/notify.js";
import { adjustStockItem, availableQuantity } from "../lib/stock.js";
import { nextSalesOrderNumber, nextDeliveryNumber } from "../lib/salesOrderNumber.js";
import { createInvoiceFromDelivery, createInvoiceFromConsignmentStatement, createInvoiceFromPosSale, createCreditNoteFromReturn } from "../lib/invoicing.js";
import { PeriodClosedError } from "../lib/accountingPeriod.js";
import { computeCustomerOutstandingBalance } from "../lib/finance.js";
import { lookupTaxRatePct } from "../lib/taxRate.js";
import { computeShippingFee, computeOrderWeightGrams } from "../lib/shipping.js";
import { salesByBook, type Granularity } from "../lib/salesTracking.js";
import { commissions, getCommissionRate, setCommissionRate, type CommissionGranularity } from "../lib/commissions.js";

const customerSchema = z.object({
  category: z.nativeEnum(CustomerCategory),
  name: z.string().min(1),
  contact_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  relation_mode: z.enum(["ferme", "depot_vente"]).optional(),
  payment_terms: z.string().optional(),
  credit_limit: z.number().nonnegative().optional(),
  tax_id: z.string().optional(),
  shipping_zone: z.nativeEnum(ShippingZone).optional(),
});

const customerDiscountSchema = z.object({
  discount_pct: z.number().min(0).max(100),
  label: z.string().optional(),
  valid_from: z.string().datetime().optional(),
  valid_until: z.string().datetime().optional(),
});

const priceSchema = z.object({
  country: z.string().min(1),
  currency: z.string().min(1),
  price: z.number().positive(),
  effective_from: z.string().datetime(),
});

const orderLineSchema = z.object({
  isbn_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  unit_price: z.number().positive(),
  // Non fourni : calculé automatiquement (Ch. 18 §18.9) plutôt qu'un défaut à 0.
  tax_rate: z.number().min(0).max(100).optional(),
});

const salesOrderSchema = z.object({
  customer_id: z.string().uuid(),
  channel: z.nativeEnum(SalesChannel),
  location_id: z.string().uuid(),
  lines: z.array(orderLineSchema).min(1),
});

const deliverySchema = z.object({
  carrier: z.string().optional(),
  lines: z.array(z.object({ isbn_id: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
});

const consignmentSchema = z.object({
  customer_id: z.string().uuid(),
  location_id: z.string().uuid(),
  isbn_id: z.string().uuid(),
  quantity_deposited: z.number().int().positive(),
});

const consignmentStatementSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  quantity_sold: z.number().int().nonnegative(),
});

const posSaleSchema = z
  .object({
    isbn_id: z.string().uuid().optional(),
    location_id: z.string().uuid().optional(),
    // Livre hors catalogue (provisoire) : au moins le titre.
    off_catalogue_title: z.string().max(300).optional(),
    off_catalogue_author: z.string().max(200).optional(),
    off_catalogue_isbn: z.string().max(40).optional(),
    quantity: z.number().int().positive(),
    unit_price: z.number().positive(),
    payment_method: z.nativeEnum(PosPaymentMethod),
    event_label: z.string().optional(),
    // Client optionnel (au choix du commercial).
    customer_id: z.string().uuid().optional(),
    point_of_sale_id: z.string().uuid().optional(),
  })
  .refine((d) => (d.isbn_id && d.location_id) || (d.off_catalogue_title && d.off_catalogue_title.trim().length > 0), {
    message: "Indiquez un ouvrage du catalogue (ISBN + lieu) ou un livre hors catalogue (titre).",
  });

const pointOfSaleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["librairie", "salon", "en_ligne", "autre"]).default("librairie"),
});

const pointOfSalePatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  type: z.enum(["librairie", "salon", "en_ligne", "autre"]).optional(),
  active: z.boolean().optional(),
});

const customerReturnSchema = z.object({
  customer_id: z.string().uuid(),
  origin_delivery_id: z.string().uuid().optional(),
});

const returnReceiveSchema = z.object({
  lines: z
    .array(z.object({ isbn_id: z.string().uuid(), quantity: z.number().int().positive(), verdict: z.nativeEnum(ReturnLineVerdict), location_id: z.string().uuid() }))
    .min(1),
});

// Résout la remise applicable à un client (Ch. 17 §17.4) : remise
// spécifique en cours de validité en priorité, sinon la grille de sa catégorie.
async function resolveDiscountPct(customerId: string): Promise<number> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const now = new Date();
  const specific = await prisma.customerDiscount.findFirst({
    where: {
      customerId,
      OR: [{ validFrom: null }, { validFrom: { lte: now } }],
      AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: now } }] }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (specific) return Number(specific.discountPct);
  const grid = await prisma.discountGrid.findUnique({ where: { category: customer.category } });
  return grid ? Number(grid.discountPct) : 0;
}

// Encours client (Ch. 17 §17.3, §17.5) : calcul précis porté par le module
// Finance (Lot 5) — somme des soldes dus (facture − paiements − avoirs).
const computeOutstandingBalance = computeCustomerOutstandingBalance;

// Ch. 17 : mise en marché des ouvrages — clients, conditions commerciales,
// commandes, ventes fermes et dépôts-ventes, vente directe, livraisons, retours.
export default async function commercialRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/customers", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const query = request.query as { category?: CustomerCategory };
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, ...(query.category ? { category: query.category } : {}) },
      orderBy: { name: "asc" },
    });
    return reply.send(customers);
  });

  fastify.post("/api/v1/customers", { preHandler: requireAuth }, async (request, reply) => {
    // Création d'un client : le commercial, mais aussi la Direction et la Finance
    // — les mêmes profils qui peuvent initier une commande à facturer, pour
    // pouvoir ajouter un client sans quitter ce formulaire (sinon, blocage).
    const perms = request.user!.permissions;
    if (!(perms.has("commercial:saisie") || perms.has("commercial:validation") || perms.has("finance:saisie"))) {
      return reply.code(403).send({ code: "forbidden", message: "Réservé au commercial, à la direction ou à la Finance." });
    }
    const parsed = customerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    const customer = await prisma.customer.create({
      data: {
        category: body.category,
        name: body.name,
        contactName: body.contact_name,
        email: body.email,
        phone: body.phone,
        address: body.address,
        relationMode: body.relation_mode,
        paymentTerms: body.payment_terms,
        creditLimit: body.credit_limit,
        taxId: body.tax_id,
        shippingZone: body.shipping_zone,
        createdBy: request.user!.id,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "customer",
      entityId: customer.id,
      newValues: body,
      ipAddress: request.ip,
    });
    return reply.code(201).send(customer);
  });

  fastify.get("/api/v1/customers/:id", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null }, include: { discounts: true } });
    if (!customer) {
      return reply.code(404).send({ code: "not_found", message: "Client introuvable." });
    }
    const outstandingBalance = await computeOutstandingBalance(id);
    return reply.send({ ...customer, outstandingBalance });
  });

  // Remise hors grille : exige une validation tracée (commercial:administration, §17.4).
  fastify.post(
    "/api/v1/customers/:id/discounts",
    { preHandler: requirePermission("commercial", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = customerDiscountSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
      if (!customer) {
        return reply.code(404).send({ code: "not_found", message: "Client introuvable." });
      }
      const grid = await prisma.discountGrid.findUnique({ where: { category: customer.category } });
      const isOffGrid = !grid || parsed.data.discount_pct > Number(grid.discountPct);
      if (isOffGrid && !request.user!.permissions.has("commercial:administration")) {
        return reply.code(403).send({
          code: "off_grid_discount_requires_approval",
          message: "Une remise hors grille exige une validation de la direction commerciale.",
        });
      }
      const discount = await prisma.customerDiscount.create({
        data: {
          customerId: id,
          discountPct: parsed.data.discount_pct,
          label: parsed.data.label,
          validFrom: parsed.data.valid_from ? new Date(parsed.data.valid_from) : undefined,
          validUntil: parsed.data.valid_until ? new Date(parsed.data.valid_until) : undefined,
          approvedBy: isOffGrid ? request.user!.id : undefined,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "customer_discount",
        entityId: discount.id,
        newValues: parsed.data,
        ipAddress: request.ip,
      });
      return reply.code(201).send(discount);
    },
  );

  // Suivi des ventes par ouvrage : sorties vs ventes réelles (montant encaissé)
  // et écart (GAP), avec découpage semaine/mois. Réservé aux profils commerciaux,
  // finance et direction (commercial:consultation). Dates optionnelles (ISO).
  fastify.get("/api/v1/commercial/sales-by-book", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const q = request.query as { from?: string; to?: string; granularity?: string };
    const granularity: Granularity = q.granularity === "week" ? "week" : "month";
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return reply.code(400).send({ code: "validation_error", message: "Dates invalides (format attendu : AAAA-MM-JJ)." });
    }
    return reply.send(await salesByBook({ from, to, granularity }));
  });

  // Commissions commerciales : par commercial, taux appliqué (10 % par défaut),
  // avec découpage semaine/mois/semestre/année. Consultation ouverte au
  // commercial, à la finance et à la direction.
  // Commissions : consultables par le pôle commercial ET par la direction
  // financière (qui les paie — rattachement à la finance demandé le 25/07/2026).
  fastify.get("/api/v1/commercial/commissions", { preHandler: requireAnyPermission([{ module: "commercial", action: "consultation" }, { module: "finance", action: "consultation" }]) }, async (request, reply) => {
    const q = request.query as { from?: string; to?: string; granularity?: string };
    const allowed = ["week", "month", "semester", "year"];
    const granularity = (allowed.includes(q.granularity ?? "") ? q.granularity : "month") as CommissionGranularity;
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return reply.code(400).send({ code: "validation_error", message: "Dates invalides (format attendu : AAAA-MM-JJ)." });
    }
    return reply.send(await commissions({ from, to, granularity }));
  });

  // Taux de commission : lecture (commercial ou finance) / réglage (DAF).
  fastify.get("/api/v1/commercial/commission-rate", { preHandler: requireAnyPermission([{ module: "commercial", action: "consultation" }, { module: "finance", action: "consultation" }]) }, async (_request, reply) => {
    return reply.send({ rate: await getCommissionRate() });
  });
  fastify.put("/api/v1/commercial/commission-rate", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const parsed = z.object({ rate: z.number().positive().max(1) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Le taux doit être une fraction entre 0 et 1 (ex. 0.10 pour 10 %)." });
    }
    try {
      const rate = await setCommissionRate(parsed.data.rate, { id: request.user!.id, ip: request.ip });
      return reply.send({ ok: true, rate });
    } catch (err) {
      return reply.code(400).send({ code: "invalid_rate", message: err instanceof Error ? err.message : "Valeur invalide." });
    }
  });

  fastify.get("/api/v1/discount-grids", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const grids = await prisma.discountGrid.findMany();
    return reply.send(grids);
  });

  // Historisation native des prix (Ch. 17 §17.2) : jamais modifiée, une
  // nouvelle ligne par changement.
  fastify.post(
    "/api/v1/isbn/:isbnId/prices",
    { preHandler: requirePermission("commercial", "saisie") },
    async (request, reply) => {
      const { isbnId } = request.params as { isbnId: string };
      const parsed = priceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const price = await prisma.priceList.create({
        data: {
          isbnId,
          country: parsed.data.country,
          currency: parsed.data.currency,
          price: parsed.data.price,
          effectiveFrom: new Date(parsed.data.effective_from),
          createdBy: request.user!.id,
        },
      });
      return reply.code(201).send(price);
    },
  );

  fastify.get("/api/v1/isbn/:isbnId/prices", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const { isbnId } = request.params as { isbnId: string };
    const prices = await prisma.priceList.findMany({ where: { isbnId }, orderBy: { effectiveFrom: "desc" } });
    return reply.send(prices);
  });

  // Ch. 17 §17.5 : contrôle de disponibilité en temps réel et contrôle
  // d'encours — une commande dépassant le plafond est bloquée en attente
  // de validation, la remise du client s'applique automatiquement.
  fastify.post("/api/v1/sales-orders", { preHandler: requirePermission("commercial", "saisie") }, async (request, reply) => {
    const parsed = salesOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    const customer = await prisma.customer.findFirst({ where: { id: body.customer_id, deletedAt: null } });
    if (!customer) {
      return reply.code(404).send({ code: "not_found", message: "Client introuvable." });
    }

    for (const line of body.lines) {
      const stockItems = await prisma.stockItem.findMany({ where: { isbnId: line.isbn_id, locationId: body.location_id } });
      const available = stockItems.reduce((sum, item) => sum + availableQuantity(item), 0);
      if (available < line.quantity) {
        return reply.code(409).send({
          code: "insufficient_stock",
          message: `Stock disponible insuffisant pour la référence demandée (disponible : ${available}, demandé : ${line.quantity}).`,
        });
      }
    }

    const discountPct = await resolveDiscountPct(body.customer_id);
    const orderTotal = body.lines.reduce((sum, line) => sum + line.unit_price * line.quantity * (1 - discountPct / 100), 0);
    const outstandingBalance = await computeOutstandingBalance(body.customer_id);
    const defaultTaxRatePct = await lookupTaxRatePct(prisma);
    const totalWeightGrams = await computeOrderWeightGrams(prisma, body.lines);
    const shippingFee = await computeShippingFee(prisma, body.customer_id, totalWeightGrams, orderTotal);
    const overLimit = customer.creditLimit !== null && outstandingBalance + orderTotal + shippingFee > Number(customer.creditLimit);

    const orderNumber = await nextSalesOrderNumber();
    const order = await prisma.salesOrder.create({
      data: {
        customerId: body.customer_id,
        orderNumber,
        channel: body.channel,
        status: overLimit ? SalesOrderStatus.blocked_credit : SalesOrderStatus.confirmed,
        blockReason: overLimit ? "Plafond d'encours dépassé" : undefined,
        shippingFee,
        createdBy: request.user!.id,
        lines: {
          create: body.lines.map((line) => ({
            isbnId: line.isbn_id,
            quantity: line.quantity,
            unitPrice: line.unit_price,
            discountPct,
            taxRate: line.tax_rate ?? defaultTaxRatePct,
          })),
        },
      },
      include: { lines: true },
    });

    if (overLimit) {
      await notifyRole({
        roleCode: "RESP_COMMERCIAL",
        type: "validation",
        priority: "high",
        title: "Commande bloquée : encours dépassé",
        body: `La commande ${orderNumber} dépasse le plafond d'encours de ${customer.name}.`,
        entityType: "sales_order",
        entityId: order.id,
      });
    } else {
      // Confirmation : réservation du stock (§17.5 point 5).
      await prisma.$transaction(async (tx) => {
        for (const line of body.lines) {
          const stockItems = await tx.stockItem.findMany({ where: { isbnId: line.isbn_id, locationId: body.location_id } });
          let remaining = line.quantity;
          for (const item of stockItems) {
            if (remaining <= 0) break;
            const reservable = Math.min(remaining, availableQuantity(item));
            if (reservable <= 0) continue;
            await adjustStockItem(tx, line.isbn_id, body.location_id, item.printRun, 0, reservable);
            remaining -= reservable;
          }
        }
      });
    }

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "sales_order",
      entityId: order.id,
      newValues: { orderNumber, status: order.status },
      ipAddress: request.ip,
    });

    return reply.code(201).send(order);
  });

  fastify.get("/api/v1/sales-orders", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const query = request.query as { customer_id?: string; status?: SalesOrderStatus };
    const orders = await prisma.salesOrder.findMany({
      where: { ...(query.customer_id ? { customerId: query.customer_id } : {}), ...(query.status ? { status: query.status } : {}) },
      include: { lines: true, customer: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(orders);
  });

  fastify.get("/api/v1/sales-orders/:id", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true, deliveries: { include: { lines: true } }, customer: true } });
    if (!order) {
      return reply.code(404).send({ code: "not_found", message: "Commande introuvable." });
    }
    return reply.send(order);
  });

  // Déblocage d'une commande en dépassement d'encours (§17.5) : réservé à la
  // direction commerciale ou financière.
  fastify.post(
    "/api/v1/sales-orders/:id/approve",
    { preHandler: requirePermission("commercial", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const order = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!order) {
        return reply.code(404).send({ code: "not_found", message: "Commande introuvable." });
      }
      if (order.status !== SalesOrderStatus.blocked_credit) {
        return reply.code(409).send({ code: "invalid_transition", message: "Seule une commande bloquée pour encours peut être approuvée." });
      }
      const updated = await prisma.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.confirmed, approvedBy: request.user!.id, blockReason: null },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "sales_order",
        entityId: id,
        newValues: { status: "confirmed", approvedOverCreditLimit: true },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    },
  );

  fastify.patch(
    "/api/v1/sales-orders/:id/status",
    { preHandler: requirePermission("commercial", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ status: z.enum(["preparing", "cancelled"]) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const updated = await prisma.salesOrder.update({ where: { id }, data: { status: parsed.data.status } });
      return reply.send(updated);
    },
  );

  // Ch. 17 §17.8 : bon de livraison rapproché des mouvements de stock (Ch. 16
  // §16.6) — reliquats gérés par livraisons multiples sur la même commande.
  fastify.post(
    "/api/v1/sales-orders/:id/deliveries",
    { preHandler: requirePermission("commercial", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = deliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const order = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!order) {
        return reply.code(404).send({ code: "not_found", message: "Commande introuvable." });
      }
      if (!["confirmed", "preparing", "shipped"].includes(order.status)) {
        return reply.code(409).send({ code: "invalid_transition", message: "Cette commande ne peut pas être livrée dans son état actuel." });
      }

      const deliveryNumber = await nextDeliveryNumber();
      try {
        const delivery = await prisma.$transaction(async (tx) => {
          const created = await tx.delivery.create({
            data: {
              orderId: id,
              deliveryNumber,
              carrier: parsed.data.carrier,
              shippedAt: new Date(),
              lines: { create: parsed.data.lines.map((line) => ({ isbnId: line.isbn_id, quantity: line.quantity })) },
            },
            include: { lines: true },
          });

          for (const line of parsed.data.lines) {
            const stockItems = await tx.stockItem.findMany({ where: { isbnId: line.isbn_id, quantityReserved: { gt: 0 } } });
            let remaining = line.quantity;
            for (const item of stockItems) {
              if (remaining <= 0) break;
              const released = Math.min(remaining, item.quantityReserved);
              if (released <= 0) continue;
              await tx.stockMovement.create({
                data: {
                  type: "sale_out",
                  isbnId: line.isbn_id,
                  printRun: item.printRun,
                  fromLocationId: item.locationId,
                  quantity: released,
                  reason: `Livraison ${deliveryNumber} (commande ${order.orderNumber})`,
                  referenceType: "delivery",
                  referenceId: created.id,
                  status: "completed",
                  movedBy: request.user!.id,
                },
              });
              await adjustStockItem(tx, line.isbn_id, item.locationId, item.printRun, -released, -released);
              remaining -= released;
            }
          }

          await tx.salesOrder.update({ where: { id }, data: { status: "shipped" } });
          // Ch. 18 §18.2 : la livraison d'une vente ferme génère automatiquement
          // sa facture (et, en cascade, les droits d'auteur, Ch. 9 §9.5).
          const invoice = await createInvoiceFromDelivery(tx, created.id);
          return { delivery: created, invoice };
        });

        await writeAuditLog({
          userId: request.user!.id,
          action: "create",
          entityType: "invoice",
          entityId: delivery.invoice.id,
          newValues: { invoiceNumber: delivery.invoice.invoiceNumber, sourceType: "delivery", sourceId: delivery.delivery.id },
          ipAddress: request.ip,
        });

        return reply.code(201).send(delivery.delivery);
      } catch (err) {
        if (err instanceof PeriodClosedError) {
          return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
        }
        throw err;
      }
    },
  );

  fastify.patch(
    "/api/v1/deliveries/:id/confirm",
    { preHandler: requirePermission("commercial", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const delivery = await prisma.delivery.update({ where: { id }, data: { deliveredAt: new Date() } });
      await prisma.salesOrder.update({ where: { id: delivery.orderId }, data: { status: "delivered" } });
      return reply.send(delivery);
    },
  );

  // Ch. 17 §17.6 : dépôt-vente — les exemplaires restent la propriété
  // d'Éclosion Édition ; seules les ventes relevées sont facturées.
  fastify.post("/api/v1/consignments", { preHandler: requirePermission("commercial", "saisie") }, async (request, reply) => {
    const parsed = consignmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const location = await prisma.stockLocation.findUnique({ where: { id: parsed.data.location_id } });
    if (!location || location.type !== "depot_vente" || location.customerId !== parsed.data.customer_id) {
      return reply.code(409).send({
        code: "invalid_location",
        message: "Le lieu doit être un dépôt-vente rattaché à ce client.",
      });
    }

    const consignment = await prisma.$transaction(async (tx) => {
      const created = await tx.consignment.create({
        data: {
          customerId: parsed.data.customer_id,
          locationId: parsed.data.location_id,
          isbnId: parsed.data.isbn_id,
          quantityDeposited: parsed.data.quantity_deposited,
        },
      });
      await tx.stockMovement.create({
        data: {
          type: "consignment_out",
          isbnId: parsed.data.isbn_id,
          printRun: 0,
          toLocationId: parsed.data.location_id,
          quantity: parsed.data.quantity_deposited,
          reason: "Mise en dépôt-vente",
          referenceType: "consignment",
          referenceId: created.id,
          status: "completed",
          movedBy: request.user!.id,
        },
      });
      await adjustStockItem(tx, parsed.data.isbn_id, parsed.data.location_id, 0, parsed.data.quantity_deposited);
      return created;
    });

    return reply.code(201).send(consignment);
  });

  fastify.get("/api/v1/consignments", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const query = request.query as { customer_id?: string };
    const consignments = await prisma.consignment.findMany({
      where: query.customer_id ? { customerId: query.customer_id } : {},
      include: { statements: true },
      orderBy: { depositedAt: "desc" },
    });
    return reply.send(consignments);
  });

  // Relevé de ventes réalisées (§17.6) : seules ces ventes sont facturées et
  // génèrent des droits d'auteur (Lot 5, non encore implémenté).
  fastify.post(
    "/api/v1/consignments/:id/statements",
    { preHandler: requirePermission("commercial", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = consignmentStatementSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const consignment = await prisma.consignment.findUnique({ where: { id } });
      if (!consignment) {
        return reply.code(404).send({ code: "not_found", message: "Dépôt-vente introuvable." });
      }

      const statement = await prisma.$transaction(async (tx) => {
        const created = await tx.consignmentStatement.create({
          data: {
            consignmentId: id,
            periodStart: new Date(parsed.data.period_start),
            periodEnd: new Date(parsed.data.period_end),
            quantitySold: parsed.data.quantity_sold,
            receivedAt: new Date(),
          },
        });
        if (parsed.data.quantity_sold > 0) {
          await tx.stockMovement.create({
            data: {
              type: "sale_out",
              isbnId: consignment.isbnId,
              printRun: 0,
              fromLocationId: consignment.locationId!,
              quantity: parsed.data.quantity_sold,
              reason: "Relevé de dépôt-vente",
              referenceType: "consignment_statement",
              referenceId: created.id,
              status: "completed",
              movedBy: request.user!.id,
            },
          });
          await adjustStockItem(tx, consignment.isbnId, consignment.locationId!, 0, -parsed.data.quantity_sold);
        }
        return created;
      });

      return reply.code(201).send(statement);
    },
  );

  fastify.patch(
    "/api/v1/consignment-statements/:id/validate",
    { preHandler: requirePermission("commercial", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await prisma.$transaction(async (tx) => {
          const statement = await tx.consignmentStatement.update({ where: { id }, data: { validatedAt: new Date() } });
          // Ch. 17 §17.6, Ch. 18 §18.2 : la validation du relevé génère la
          // facture et les droits d'auteur (Ch. 9 §9.5) — pas la simple saisie du relevé.
          const invoice = await createInvoiceFromConsignmentStatement(tx, statement.id);
          return { statement, invoice };
        });
        if (result.invoice) {
          await writeAuditLog({
            userId: request.user!.id,
            action: "create",
            entityType: "invoice",
            entityId: result.invoice.id,
            newValues: { invoiceNumber: result.invoice.invoiceNumber, sourceType: "consignment_statement", sourceId: result.statement.id },
            ipAddress: request.ip,
          });
        }
        return reply.send(result.statement);
      } catch (err) {
        if (err instanceof PeriodClosedError) {
          return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
        }
        throw err;
      }
    },
  );

  // Ch. 17 §17.7 : vente au comptoir et sur salons — chaque encaissement
  // (espèces, carte, mobile money) est immédiat, sans réservation préalable.
  fastify.post("/api/v1/pos-sales", { preHandler: requirePermission("commercial", "saisie") }, async (request, reply) => {
    const parsed = posSaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }

    // Vente HORS CATALOGUE (livre non encore référencé) : enregistrée comme
    // provisoire — pas de mouvement de stock, pas de facture/droits d'auteur tant
    // qu'elle n'est pas rattachée à un ouvrage officiel. Préserve l'intégrité.
    if (!parsed.data.isbn_id) {
      const sale = await prisma.posSale.create({
        data: {
          isbnId: null,
          offCatalogueTitle: parsed.data.off_catalogue_title,
          offCatalogueAuthor: parsed.data.off_catalogue_author,
          offCatalogueIsbn: parsed.data.off_catalogue_isbn,
          quantity: parsed.data.quantity,
          unitPrice: parsed.data.unit_price,
          paymentMethod: parsed.data.payment_method,
          eventLabel: parsed.data.event_label,
          customerId: parsed.data.customer_id ?? null,
          pointOfSaleId: parsed.data.point_of_sale_id,
          soldBy: request.user!.id,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "pos_sale",
        entityId: sale.id,
        newValues: { off_catalogue: true, title: parsed.data.off_catalogue_title, quantity: parsed.data.quantity },
        ipAddress: request.ip,
      });
      return reply.code(201).send(sale);
    }

    // Vente au CATALOGUE : ISBN + lieu garantis par le schéma (refine).
    const isbnId = parsed.data.isbn_id;
    const locationId = parsed.data.location_id!;
    const stockItems = await prisma.stockItem.findMany({ where: { isbnId, locationId } });
    const available = stockItems.reduce((sum, item) => sum + availableQuantity(item), 0);
    if (available < parsed.data.quantity) {
      return reply.code(409).send({ code: "insufficient_stock", message: "Stock disponible insuffisant pour cette vente." });
    }

    try {
      const sale = await prisma.$transaction(async (tx) => {
        const created = await tx.posSale.create({
          data: {
            isbnId,
            quantity: parsed.data.quantity,
            unitPrice: parsed.data.unit_price,
            paymentMethod: parsed.data.payment_method,
            eventLabel: parsed.data.event_label,
            customerId: parsed.data.customer_id ?? null,
            pointOfSaleId: parsed.data.point_of_sale_id,
            soldBy: request.user!.id,
          },
        });
        await tx.stockMovement.create({
          data: {
            type: "sale_out",
            isbnId,
            printRun: 0,
            fromLocationId: locationId,
            quantity: parsed.data.quantity,
            reason: "Vente au comptoir",
            referenceType: "pos_sale",
            referenceId: created.id,
            status: "completed",
            movedBy: request.user!.id,
          },
        });
        await adjustStockItem(tx, isbnId, locationId, 0, -parsed.data.quantity);
        // Ch. 18 §18.2, §18.7 : facture immédiate + encaissement + droits d'auteur.
        const invoice = await createInvoiceFromPosSale(tx, created.id);
        return { sale: created, invoice };
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "invoice",
        entityId: sale.invoice.id,
        newValues: { invoiceNumber: sale.invoice.invoiceNumber, sourceType: "pos_sale", sourceId: sale.sale.id },
        ipAddress: request.ip,
      });

      return reply.code(201).send(sale.sale);
    } catch (err) {
      if (err instanceof PeriodClosedError) {
        return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
      }
      throw err;
    }
  });

  fastify.get("/api/v1/pos-sales", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const q = request.query as { provisional?: string };
    // provisional=true → uniquement les ventes hors catalogue à rattacher.
    const where = q.provisional === "true" ? { isbnId: null } : {};
    const sales = await prisma.posSale.findMany({ where, orderBy: { soldAt: "desc" }, take: 200 });
    return reply.send(sales);
  });

  // Réconciliation d'une vente HORS CATALOGUE : la rattacher à un ouvrage
  // désormais référencé. À ce moment seulement, la facture et les droits d'auteur
  // sont générés (reconnaissance du chiffre d'affaires). Le stock physique reste
  // géré par le magasin (aucun mouvement automatique, pour éviter un stock négatif
  // rétroactif). Réservé à la validation commerciale.
  fastify.post("/api/v1/pos-sales/:id/reconcile", { preHandler: requirePermission("commercial", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ isbn_id: z.string().uuid() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: "validation_error", message: "ISBN cible requis.", details: body.error.issues });
    const sale = await prisma.posSale.findUnique({ where: { id } });
    if (!sale) return reply.code(404).send({ code: "not_found", message: "Vente introuvable." });
    if (sale.isbnId) return reply.code(409).send({ code: "already_catalogued", message: "Cette vente est déjà rattachée à un ouvrage." });
    const isbn = await prisma.isbn.findUnique({ where: { id: body.data.isbn_id } });
    if (!isbn) return reply.code(404).send({ code: "isbn_not_found", message: "ISBN cible introuvable." });
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.posSale.update({ where: { id }, data: { isbnId: body.data.isbn_id } });
        const invoice = await createInvoiceFromPosSale(tx, id);
        return invoice;
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "pos_sale",
        entityId: id,
        oldValues: { isbnId: null, offCatalogueTitle: sale.offCatalogueTitle },
        newValues: { isbnId: body.data.isbn_id, invoiceId: result.id },
        ipAddress: request.ip,
      });
      return reply.send({ reconciled: true, invoice_id: result.id });
    } catch (err) {
      if (err instanceof PeriodClosedError) {
        return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
      }
      throw err;
    }
  });

  // --- Points de vente (librairie, salon, boutique en ligne…) ---------------
  fastify.get("/api/v1/points-of-sale", { preHandler: requirePermission("commercial", "consultation") }, async (_request, reply) => {
    const points = await prisma.pointOfSale.findMany({ orderBy: { name: "asc" } });
    return reply.send(points);
  });

  fastify.post("/api/v1/points-of-sale", { preHandler: requirePermission("commercial", "administration") }, async (request, reply) => {
    const parsed = pointOfSaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const point = await prisma.pointOfSale.create({ data: { name: parsed.data.name, type: parsed.data.type } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "point_of_sale", entityId: point.id, newValues: { name: point.name }, ipAddress: request.ip });
    return reply.code(201).send(point);
  });

  fastify.patch("/api/v1/points-of-sale/:id", { preHandler: requirePermission("commercial", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = pointOfSalePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const point = await prisma.pointOfSale.findUnique({ where: { id } });
    if (!point) return reply.code(404).send({ code: "not_found", message: "Point de vente introuvable." });
    const updated = await prisma.pointOfSale.update({ where: { id }, data: parsed.data });
    return reply.send(updated);
  });

  // Ch. 17 §17.9 : autorisation, réception, verdict exemplaire par exemplaire.
  fastify.post("/api/v1/customer-returns", { preHandler: requirePermission("commercial", "saisie") }, async (request, reply) => {
    const parsed = customerReturnSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const created = await prisma.customerReturn.create({
      data: {
        customerId: parsed.data.customer_id,
        originDeliveryId: parsed.data.origin_delivery_id,
        authorizedAt: new Date(),
      },
    });
    return reply.code(201).send(created);
  });

  fastify.post(
    "/api/v1/customer-returns/:id/receive",
    { preHandler: requirePermission("commercial", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = returnReceiveSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const customerReturn = await prisma.customerReturn.findUnique({ where: { id } });
      if (!customerReturn) {
        return reply.code(404).send({ code: "not_found", message: "Retour introuvable." });
      }

      try {
        const updated = await prisma.$transaction(async (tx) => {
          for (const line of parsed.data.lines) {
            await tx.returnLine.create({
              data: { returnId: id, isbnId: line.isbn_id, quantity: line.quantity, verdict: line.verdict },
            });
            if (line.verdict === "resaleable") {
              await tx.stockMovement.create({
                data: {
                  type: "customer_return",
                  isbnId: line.isbn_id,
                  printRun: 0,
                  toLocationId: line.location_id,
                  quantity: line.quantity,
                  reason: "Retour client — remis en stock vendable",
                  referenceType: "customer_return",
                  referenceId: id,
                  status: "completed",
                  movedBy: request.user!.id,
                },
              });
              await adjustStockItem(tx, line.isbn_id, line.location_id, 0, line.quantity);
            } else if (line.verdict === "pulp") {
              // Traçabilité (§16.4 : incidence comptable transmise au module Finance)
              // sans variation de stock : ces exemplaires n'ont jamais été
              // recomptés en stock vendable, il n'y a donc rien à en retrancher.
              await tx.stockMovement.create({
                data: {
                  type: "pulping",
                  isbnId: line.isbn_id,
                  printRun: 0,
                  fromLocationId: line.location_id,
                  quantity: line.quantity,
                  reason: "Retour client — mis au pilon",
                  referenceType: "customer_return",
                  referenceId: id,
                  status: "completed",
                  movedBy: request.user!.id,
                },
              });
            } else if (line.verdict === "damaged") {
              // Ch. 16 §16.7 : ni remis en stock vendable ni détruit — un
              // compartiment de stock "déclassé" à part entière, candidat aux
              // opérations commerciales (§16.10) plutôt qu'une simple mention.
              await tx.stockMovement.create({
                data: {
                  type: "customer_return",
                  isbnId: line.isbn_id,
                  printRun: 0,
                  toLocationId: line.location_id,
                  quantity: line.quantity,
                  reason: "Retour client — déclassé (défraîchi)",
                  referenceType: "customer_return",
                  referenceId: id,
                  status: "completed",
                  movedBy: request.user!.id,
                },
              });
              await adjustStockItem(tx, line.isbn_id, line.location_id, 0, line.quantity, 0, "declasse");
            }
          }
          const result = await tx.customerReturn.update({ where: { id }, data: { receivedAt: new Date() } });
          // Ch. 17 §17.9, Ch. 18 §18.2 : avoir rattaché à la facture d'origine et
          // recalcul des droits d'auteur, quel que soit le devenir physique des exemplaires.
          const creditNote = await createCreditNoteFromReturn(tx, id);
          return { customerReturn: result, creditNote };
        });

        if (updated.creditNote) {
          await writeAuditLog({
            userId: request.user!.id,
            action: "create",
            entityType: "invoice",
            entityId: updated.creditNote.id,
            newValues: { invoiceNumber: updated.creditNote.invoiceNumber, sourceType: "customer_return", sourceId: updated.customerReturn.id },
            ipAddress: request.ip,
          });
        }

        return reply.send(updated.customerReturn);
      } catch (err) {
        if (err instanceof PeriodClosedError) {
          return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
        }
        throw err;
      }
    },
  );

  fastify.get("/api/v1/customer-returns", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const query = request.query as { customer_id?: string };
    const returns = await prisma.customerReturn.findMany({
      where: query.customer_id ? { customerId: query.customer_id } : {},
      include: { lines: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(returns);
  });
}
