import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StockLocationType, StockMovementType, InventoryType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyRole } from "../lib/notify.js";
import { adjustStockItem, availableQuantity } from "../lib/stock.js";

// Ch. 16 §16.4 : chaque type de mouvement a un effet déterminé sur le
// physique/réservé aux lieux source/destination. "transfer" est traité à
// part (statut en_transit jusqu'à confirmation, §16.4).
const MOVEMENT_REQUIREMENTS: Record<StockMovementType, { from: boolean; to: boolean }> = {
  production_in: { from: false, to: true },
  sale_out: { from: true, to: false },
  consignment_out: { from: true, to: true },
  consignment_return: { from: true, to: true },
  customer_return: { from: false, to: true },
  transfer: { from: true, to: true },
  press_copy: { from: true, to: false },
  author_copy: { from: true, to: false },
  pulping: { from: true, to: false },
  inventory_adjustment: { from: false, to: false },
};

const stockLocationSchema = z.object({
  type: z.nativeEnum(StockLocationType),
  label: z.string().min(1),
  parent_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
});

const stockMovementSchema = z.object({
  type: z.nativeEnum(StockMovementType),
  isbn_id: z.string().uuid(),
  print_run: z.number().int().nonnegative().default(0),
  from_location_id: z.string().uuid().optional(),
  to_location_id: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
  reason: z.string().min(1),
  reference_type: z.string().optional(),
  reference_id: z.string().optional(),
});

const inventorySchema = z.object({
  type: z.nativeEnum(InventoryType),
  location_id: z.string().uuid(),
  blind: z.boolean().default(true),
});

async function isbnStockAlertThreshold(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: "stock_default_alert_threshold" } });
  return (setting?.value as number | undefined) ?? 20;
}

// Masque la quantité théorique tant que le comptage à l'aveugle est en cours
// (Ch. 16 §16.8) : révélée seulement une fois le comptage saisi pour cette
// ligne, ou une fois l'inventaire clos. Propriété du processus, pas du rôle.
function maskBlindLine(
  line: { theoreticalQty: number; countedQty: number | null; [key: string]: unknown },
  inventory: { blind: boolean; status: string },
) {
  if (!inventory.blind || inventory.status === "closed" || line.countedQty !== null) {
    return line;
  }
  const { theoreticalQty: _hidden, ...rest } = line;
  return rest;
}

// Ch. 16 : gestion physique et comptable des exemplaires — entrées, sorties,
// emplacements, inventaires, alertes. Charnière entre fabrication (Ch. 15)
// et vente (Ch. 17).
export default async function stockRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/stock-locations", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const locations = await prisma.stockLocation.findMany({ orderBy: { label: "asc" } });
    return reply.send(locations);
  });

  fastify.post("/api/v1/stock-locations", { preHandler: requirePermission("stock", "administration") }, async (request, reply) => {
    const parsed = stockLocationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    if (parsed.data.type === "depot_vente" && !parsed.data.customer_id) {
      return reply.code(400).send({ code: "validation_error", message: "Un lieu de dépôt-vente doit être rattaché à un client." });
    }
    const location = await prisma.stockLocation.create({
      data: {
        type: parsed.data.type,
        label: parsed.data.label,
        parentId: parsed.data.parent_id,
        customerId: parsed.data.customer_id,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "stock_location",
      entityId: location.id,
      newValues: parsed.data,
      ipAddress: request.ip,
    });
    return reply.code(201).send(location);
  });

  fastify.get("/api/v1/stock-items", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const query = request.query as { isbn_id?: string; location_id?: string };
    const items = await prisma.stockItem.findMany({
      where: {
        ...(query.isbn_id ? { isbnId: query.isbn_id } : {}),
        ...(query.location_id ? { locationId: query.location_id } : {}),
      },
      include: { isbn: true, location: true },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send(items.map((item) => ({ ...item, quantityAvailable: availableQuantity(item) })));
  });

  // Ruptures et seuils d'alerte (Ch. 16 §16.5) : remontée au tableau de bord
  // et suggestion de réimpression le cas échéant (Ch. 15 §15.8).
  fastify.get("/api/v1/stock-alerts", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const items = await prisma.stockItem.findMany({ include: { isbn: true, location: true } });
    const defaultThreshold = await isbnStockAlertThreshold();
    const alerts = items
      .map((item) => ({ ...item, quantityAvailable: availableQuantity(item) }))
      .filter((item) => item.quantityAvailable <= (item.alertThreshold ?? defaultThreshold))
      .map((item) => ({
        ...item,
        severity: item.quantityAvailable <= item.outOfStockThreshold ? "rupture" : "alerte",
      }));
    return reply.send(alerts);
  });

  // Ch. 16 §16.4 : aucun mouvement sans type, motif et responsable. Chaque
  // mouvement met à jour le stock en temps réel (transactionnel).
  fastify.post("/api/v1/stock-movements", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = stockMovementSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    const requirements = MOVEMENT_REQUIREMENTS[body.type];
    if (requirements.from && !body.from_location_id) {
      return reply.code(400).send({ code: "validation_error", message: `Le mouvement « ${body.type} » exige un lieu d'origine.` });
    }
    if (requirements.to && !body.to_location_id) {
      return reply.code(400).send({ code: "validation_error", message: `Le mouvement « ${body.type} » exige un lieu de destination.` });
    }
    if (body.type === "inventory_adjustment" && !body.from_location_id && !body.to_location_id) {
      return reply.code(400).send({ code: "validation_error", message: "Une régularisation d'inventaire exige un lieu." });
    }

    const isTransfer = body.type === "transfer";
    // N'accepte le(s) lieu(x) que si ce type de mouvement les exige réellement
    // (§16.4) — un lieu superflu envoyé par erreur par le client ne doit
    // jamais créer de mouvement fantôme sur un autre lieu.
    const appliesFrom = requirements.from || (body.type === "inventory_adjustment" && !!body.from_location_id);
    const appliesTo = requirements.to || (body.type === "inventory_adjustment" && !!body.to_location_id);
    const fromLocationId = appliesFrom ? body.from_location_id : undefined;
    const toLocationId = appliesTo ? body.to_location_id : undefined;

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: {
          type: body.type,
          isbnId: body.isbn_id,
          printRun: body.print_run,
          fromLocationId,
          toLocationId,
          quantity: body.quantity,
          reason: body.reason,
          referenceType: body.reference_type,
          referenceId: body.reference_id,
          status: isTransfer ? "in_transit" : "completed",
          movedBy: request.user!.id,
        },
      });

      if (fromLocationId) {
        await adjustStockItem(tx, body.isbn_id, fromLocationId, body.print_run, -body.quantity);
      }
      // Un transfert ne crédite le lieu de destination qu'à la confirmation
      // de réception (§16.4) ; les autres types créditent immédiatement.
      if (toLocationId && !isTransfer) {
        await adjustStockItem(tx, body.isbn_id, toLocationId, body.print_run, body.quantity);
      }

      return created;
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "stock_movement",
      entityId: movement.id,
      newValues: body,
      ipAddress: request.ip,
    });

    return reply.code(201).send(movement);
  });

  fastify.patch(
    "/api/v1/stock-movements/:id/confirm-receipt",
    { preHandler: requirePermission("stock", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const movement = await prisma.stockMovement.findUnique({ where: { id } });
      if (!movement) {
        return reply.code(404).send({ code: "not_found", message: "Mouvement introuvable." });
      }
      if (movement.type !== "transfer" || movement.status !== "in_transit") {
        return reply.code(409).send({ code: "invalid_transition", message: "Ce mouvement n'est pas un transfert en transit." });
      }
      const updated = await prisma.$transaction(async (tx) => {
        await adjustStockItem(tx, movement.isbnId, movement.toLocationId!, movement.printRun, movement.quantity);
        return tx.stockMovement.update({ where: { id }, data: { status: "completed" } });
      });
      return reply.send(updated);
    },
  );

  fastify.get("/api/v1/stock-movements", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const query = request.query as { isbn_id?: string };
    const movements = await prisma.stockMovement.findMany({
      where: query.isbn_id ? { isbnId: query.isbn_id } : {},
      orderBy: { movedAt: "desc" },
      take: 200,
    });
    return reply.send(movements);
  });

  // Entrée de fabrication (Ch. 16 §16.4, Ch. 15 §15.7) : seuls les
  // exemplaires acceptés par le contrôle qualité entrent en stock vendable.
  fastify.post(
    "/api/v1/goods-receipts/:id/stock-entry",
    { preHandler: requirePermission("stock", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ location_id: z.string().uuid() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const receipt = await prisma.goodsReceipt.findUnique({
        where: { id },
        include: { po: { include: { quote: true } } },
      });
      if (!receipt) {
        return reply.code(404).send({ code: "not_found", message: "Réception introuvable." });
      }
      if (receipt.qcVerdict !== "conform" && receipt.qcVerdict !== "with_reserves") {
        return reply.code(409).send({
          code: "receipt_not_accepted",
          message: "Seuls les exemplaires acceptés par le contrôle qualité peuvent entrer en stock.",
        });
      }

      const isbn = await prisma.isbn.findFirst({ where: { manuscriptId: receipt.po.quote.manuscriptId, format: "print" } });
      if (!isbn) {
        return reply.code(409).send({ code: "isbn_missing", message: "Aucun ISBN papier attribué pour cet ouvrage." });
      }

      const movement = await prisma.$transaction(async (tx) => {
        const created = await tx.stockMovement.create({
          data: {
            type: "production_in",
            isbnId: isbn.id,
            printRun: receipt.po.reprintNumber,
            toLocationId: parsed.data.location_id,
            quantity: receipt.quantityReceived,
            reason: `Réception fabrication ${receipt.po.poNumber}`,
            referenceType: "goods_receipt",
            referenceId: receipt.id,
            status: "completed",
            movedBy: request.user!.id,
          },
        });
        await adjustStockItem(tx, isbn.id, parsed.data.location_id, receipt.po.reprintNumber, receipt.quantityReceived);
        return created;
      });

      await notifyRole({
        roleCode: "MAGASINIER",
        type: "affectation",
        priority: "medium",
        title: "Entrée de fabrication à ranger",
        body: `${receipt.quantityReceived} exemplaire(s) reçus (${receipt.po.poNumber}) à ranger.`,
        entityType: "stock_movement",
        entityId: movement.id,
      });

      return reply.code(201).send(movement);
    },
  );

  // Ch. 16 §16.8 : campagne d'inventaire — comptage à l'aveugle par défaut,
  // quantités théoriques figées au lancement.
  fastify.post("/api/v1/inventories", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = inventorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const stockItems = await prisma.stockItem.findMany({ where: { locationId: parsed.data.location_id } });

    const inventory = await prisma.inventory.create({
      data: {
        type: parsed.data.type,
        locationId: parsed.data.location_id,
        blind: parsed.data.blind,
        openedBy: request.user!.id,
        lines: {
          create: stockItems.map((item) => ({ isbnId: item.isbnId, theoreticalQty: item.quantityPhysical })),
        },
      },
      include: { lines: true },
    });

    await notifyRole({
      roleCode: "MAGASINIER",
      type: "affectation",
      priority: "medium",
      title: "Campagne d'inventaire planifiée",
      body: `Une campagne d'inventaire (${parsed.data.type}) est ouverte sur le lieu sélectionné.`,
      entityType: "inventory",
      entityId: inventory.id,
    });

    return reply.code(201).send({ ...inventory, lines: inventory.lines.map((line) => maskBlindLine(line, inventory)) });
  });

  fastify.get("/api/v1/inventories/:id", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const inventory = await prisma.inventory.findUnique({ where: { id }, include: { lines: true } });
    if (!inventory) {
      return reply.code(404).send({ code: "not_found", message: "Inventaire introuvable." });
    }
    return reply.send({ ...inventory, lines: inventory.lines.map((line) => maskBlindLine(line, inventory)) });
  });

  fastify.patch(
    "/api/v1/inventory-lines/:id",
    { preHandler: requirePermission("stock", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ counted_qty: z.number().int().nonnegative() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const line = await prisma.inventoryLine.findUnique({ where: { id } });
      if (!line) {
        return reply.code(404).send({ code: "not_found", message: "Ligne d'inventaire introuvable." });
      }
      const variance = parsed.data.counted_qty - line.theoreticalQty;
      // Double comptage en cas d'écart (§16.8) : un second comptage confirme l'écart.
      const recountRequired = variance !== 0 && !line.recountRequired;
      const updated = await prisma.inventoryLine.update({
        where: { id },
        data: { countedQty: parsed.data.counted_qty, variance, recountRequired },
      });
      return reply.send(updated);
    },
  );

  // Régularisation tracée et validée par la direction (§16.8) : crée le
  // mouvement de stock correspondant à l'écart constaté.
  fastify.post(
    "/api/v1/inventory-lines/:id/adjust",
    { preHandler: requirePermission("stock", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const line = await prisma.inventoryLine.findUnique({ where: { id }, include: { inventory: true } });
      if (!line) {
        return reply.code(404).send({ code: "not_found", message: "Ligne d'inventaire introuvable." });
      }
      if (line.countedQty === null || line.variance === null || line.variance === 0) {
        return reply.code(409).send({ code: "no_variance", message: "Aucun écart à régulariser sur cette ligne." });
      }
      if (line.adjustmentMovementId) {
        return reply.code(409).send({ code: "already_adjusted", message: "Cet écart a déjà été régularisé." });
      }
      if (!line.inventory.locationId) {
        return reply.code(409).send({ code: "location_missing", message: "L'inventaire n'a pas de lieu associé." });
      }

      const variance = line.variance;
      const updated = await prisma.$transaction(async (tx) => {
        const movement = await tx.stockMovement.create({
          data: {
            type: "inventory_adjustment",
            isbnId: line.isbnId,
            printRun: 0,
            fromLocationId: variance < 0 ? line.inventory.locationId : undefined,
            toLocationId: variance > 0 ? line.inventory.locationId : undefined,
            quantity: Math.abs(variance),
            reason: `Régularisation d'inventaire (écart ${variance})`,
            referenceType: "inventory_line",
            referenceId: line.id,
            status: "completed",
            movedBy: request.user!.id,
          },
        });
        await adjustStockItem(tx, line.isbnId, line.inventory.locationId!, 0, variance);
        return tx.inventoryLine.update({
          where: { id },
          data: { adjustmentMovementId: movement.id, recountRequired: false },
        });
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "inventory_line",
        entityId: id,
        newValues: { variance },
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  fastify.patch("/api/v1/inventories/:id/close", { preHandler: requirePermission("stock", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const inventory = await prisma.inventory.findUnique({ where: { id }, include: { lines: true } });
    if (!inventory) {
      return reply.code(404).send({ code: "not_found", message: "Inventaire introuvable." });
    }
    const pendingRecount = inventory.lines.some((line) => line.recountRequired);
    const unadjustedVariance = inventory.lines.some(
      (line) => line.variance !== null && line.variance !== 0 && !line.adjustmentMovementId,
    );
    if (pendingRecount || unadjustedVariance) {
      return reply.code(409).send({
        code: "adjustments_pending",
        message: "Des écarts restent à recompter ou à régulariser avant de clore l'inventaire.",
      });
    }
    const updated = await prisma.inventory.update({ where: { id }, data: { status: "closed", closedAt: new Date() } });
    return reply.send(updated);
  });
}
