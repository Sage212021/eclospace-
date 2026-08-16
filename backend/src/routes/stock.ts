import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StockLocationType, StockMovementType, StockMovementStatus, StockItemCondition, InventoryType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyRole } from "../lib/notify.js";
import { adjustStockItem, availableQuantity } from "../lib/stock.js";

// Rapprochement de titres (chargement de l'inventaire) : normalisation tolérante
// aux accents/casse/ponctuation + score de Dice sur bigrammes de caractères.
function normalizeTitle(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const bg = t.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}
function diceScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ba = bigrams(a);
  const bb = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const v of ba.values()) total += v;
  for (const [k, v] of bb) {
    total += v;
    const av = ba.get(k) ?? 0;
    inter += Math.min(av, v);
  }
  return total === 0 ? 0 : (2 * inter) / total;
}

// Ch. 16 §16.4 : chaque type de mouvement a un effet déterminé sur le
// physique/réservé aux lieux source/destination. "transfer" est traité à
// part (statut en_transit jusqu'à confirmation, §16.4).
const MOVEMENT_REQUIREMENTS: Record<StockMovementType, { from: boolean; to: boolean }> = {
  production_in: { from: false, to: true },
  supplier_in: { from: false, to: true },
  sale_out: { from: true, to: false },
  consignment_out: { from: true, to: true },
  consignment_return: { from: true, to: true },
  customer_return: { from: false, to: true },
  commercial_return: { from: false, to: true },
  transfer: { from: true, to: true },
  press_copy: { from: true, to: false },
  author_copy: { from: true, to: false },
  promotional_out: { from: true, to: false },
  institutional_out: { from: true, to: false },
  event_out: { from: true, to: false },
  free_out: { from: true, to: false },
  // Perte / casse / destruction : reclassement AU MÊME LIEU (le compartiment
  // source diminue, le compartiment cible augmente) — d'où from seul.
  loss: { from: true, to: false },
  damage: { from: true, to: false },
  destruction: { from: true, to: false },
  pulping: { from: true, to: false },
  inventory_adjustment: { from: false, to: false },
};

// Reclassement d'un compartiment vers un autre AU MÊME LIEU (§5, §7). La quantité
// n'est pas retirée du stock total : elle change d'état (vendable → perdu/…), ce
// qui garde le total auditable (rien ne « disparaît »).
const RECLASSIFY_OUTCOME: Partial<Record<StockMovementType, StockItemCondition>> = {
  loss: "perdu",
  damage: "declasse",
  destruction: "detruit",
};

// Types de mouvements SAISIS À LA MAIN par le magasinier — les seuls qu'il peut
// corriger ou annuler ici. Les mouvements générés par un autre document (vente,
// retour client, dépôt-vente…) portent une référence et se corrigent à la source.
const MANUAL_MOVEMENT_TYPES: StockMovementType[] = [
  "production_in",
  "supplier_in",
  "commercial_return",
  "transfer",
  "press_copy",
  "author_copy",
  "promotional_out",
  "institutional_out",
  "event_out",
  "free_out",
  "loss",
  "damage",
  "destruction",
  "pulping",
  "inventory_adjustment",
];

// Effet d'un mouvement sur le stock PHYSIQUE, compartiment par compartiment
// (mêmes règles que la création + la confirmation de transfert). Sert aussi à
// contre-passer exactement lors d'une correction ou d'une annulation.
function physicalEffects(m: {
  type: StockMovementType;
  status: StockMovementStatus;
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  condition: StockItemCondition;
}): Array<{ locationId: string; condition: StockItemCondition; delta: number }> {
  const effects: Array<{ locationId: string; condition: StockItemCondition; delta: number }> = [];
  const outcome = RECLASSIFY_OUTCOME[m.type];
  if (outcome && m.fromLocationId) {
    // Reclassement : compartiment source → compartiment cible, au même lieu.
    effects.push({ locationId: m.fromLocationId, condition: m.condition, delta: -m.quantity });
    effects.push({ locationId: m.fromLocationId, condition: outcome, delta: m.quantity });
    return effects;
  }
  if (m.fromLocationId) effects.push({ locationId: m.fromLocationId, condition: m.condition, delta: -m.quantity });
  // La destination n'est créditée que si ce n'est pas un transfert encore en transit.
  const creditsTo = m.toLocationId && (m.type !== "transfer" || m.status === "completed");
  if (creditsTo && m.toLocationId) effects.push({ locationId: m.toLocationId, condition: m.condition, delta: m.quantity });
  return effects;
}

// Erreur métier « le stock deviendrait négatif » — remontée en 409 explicite.
class StockWouldGoNegativeError extends Error {
  constructor(public locationId: string, public resulting: number) {
    super("stock_negative");
  }
}

// Applique une liste d'ajustements physiques (chacun sur son compartiment) et
// refuse tout résultat négatif (§16.1 — jamais de quantité < 0).
async function applyEffects(
  tx: Prisma.TransactionClient,
  isbnId: string,
  printRun: number,
  effects: Array<{ locationId: string; condition: StockItemCondition; delta: number }>,
): Promise<void> {
  for (const e of effects) {
    const updated = await adjustStockItem(tx, isbnId, e.locationId, printRun, e.delta, 0, e.condition);
    if (updated.quantityPhysical < 0) throw new StockWouldGoNegativeError(e.locationId, updated.quantityPhysical);
  }
}

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
  // État du compartiment (§16.7) : « declasse » pour les exemplaires abîmés
  // (« touchés »). Par défaut « vendable ».
  condition: z.enum(["vendable", "declasse"]).optional(),
});

// Correction d'une saisie : le magasinier ajuste la quantité, le motif ou l'état.
const editMovementSchema = z.object({
  quantity: z.number().int().positive().optional(),
  reason: z.string().min(1).optional(),
  condition: z.enum(["vendable", "declasse"]).optional(),
});
const cancelMovementSchema = z.object({
  reason: z.string().max(300).optional(),
});

// Un mouvement n'est corrigeable que s'il s'agit d'une SAISIE MANUELLE non
// annulée. Renvoie une charge d'erreur (409) sinon, avec un message explicite.
function correctableGuard(m: { status: StockMovementStatus; referenceType: string | null; type: StockMovementType }):
  | { code: string; message: string }
  | null {
  if (m.status === "cancelled") return { code: "already_cancelled", message: "Ce mouvement est déjà annulé." };
  if (m.referenceType || !MANUAL_MOVEMENT_TYPES.includes(m.type)) {
    return {
      code: "system_movement",
      message: "Ce mouvement provient d'un autre document (vente, retour, dépôt-vente…). Corrigez-le à sa source, pas ici.",
    };
  }
  return null;
}

// Noms lisibles des acteurs d'un mouvement (magasinier / annulateur).
async function resolveStockActorNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } },
  });
  const map = new Map<string, string>();
  for (const u of users) {
    const name = u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.username;
    map.set(u.id, name || u.username);
  }
  return map;
}

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
    const query = request.query as { isbn_id?: string; location_id?: string; condition?: "vendable" | "declasse" };
    const items = await prisma.stockItem.findMany({
      where: {
        ...(query.isbn_id ? { isbnId: query.isbn_id } : {}),
        ...(query.location_id ? { locationId: query.location_id } : {}),
        ...(query.condition ? { condition: query.condition } : {}),
      },
      include: { isbn: true, location: true },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send(items.map((item) => ({ ...item, quantityAvailable: availableQuantity(item) })));
  });

  // Ruptures et seuils d'alerte (Ch. 16 §16.5) : le stock déclassé (§16.7)
  // est un compartiment séparé, exclu du calcul de rupture du stock vendable.
  fastify.get("/api/v1/stock-alerts", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const items = await prisma.stockItem.findMany({ where: { condition: "vendable" }, include: { isbn: true, location: true } });
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

  // Stock consolidé « toutes zones » (rapport d'inventaire opérateur) : total réel
  // par ouvrage, tous lieux confondus, vendable vs déclassé, avec le détail par
  // zone. Répond au « stock réel total » visé par le rapport final.
  fastify.get("/api/v1/stock-consolidated", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const items = await prisma.stockItem.findMany({
      include: {
        isbn: {
          select: {
            isbn13: true,
            manuscript: {
              select: {
                title: true,
                workContributors: {
                  where: { role: "author" },
                  orderBy: { displayOrder: "asc" },
                  select: { partner: { select: { firstName: true, lastName: true } } },
                },
              },
            },
          },
        },
        location: { select: { id: true, label: true } },
      },
    });
    // « Stock initial » chargé par ouvrage = somme des entrées de régularisation
    // d'inventaire (le chargement de démarrage). Sert de repère auditable
    // « chargé → reste aujourd'hui ».
    const initialByIsbn = new Map<string, number>();
    const initialMoves = await prisma.stockMovement.groupBy({
      by: ["isbnId"],
      where: { type: "inventory_adjustment", status: "completed", toLocationId: { not: null } },
      _sum: { quantity: true },
    });
    for (const m of initialMoves) initialByIsbn.set(m.isbnId, m._sum.quantity ?? 0);
    // Nom d'auteur affiché (premier auteur, ordre d'affichage).
    const authorName = (contribs: Array<{ partner: { firstName: string | null; lastName: string | null } }>): string | null => {
      if (!contribs.length) return null;
      const p = contribs[0].partner;
      const n = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
      return n || null;
    };
    // Ventilation par compartiment (§5) : vendable (= disponible), déclassé,
    // perdu, détruit. Le total agrège tous les compartiments (rien ne disparaît).
    type Buckets = { vendable: number; declasse: number; perdu: number; detruit: number };
    const zero = (): Buckets => ({ vendable: 0, declasse: 0, perdu: 0, detruit: 0 });
    const add = (b: Buckets, c: StockItemCondition, q: number) => { b[c] += q; };
    const byIsbn = new Map<string, {
      isbn_id: string; isbn13: string; title: string | null; author: string | null;
      buckets: Buckets;
      locations: Map<string, { location_id: string; location_label: string } & Buckets>;
    }>();
    for (const it of items) {
      let row = byIsbn.get(it.isbnId);
      if (!row) {
        row = { isbn_id: it.isbnId, isbn13: it.isbn.isbn13, title: it.isbn.manuscript?.title ?? null, author: authorName(it.isbn.manuscript?.workContributors ?? []), buckets: zero(), locations: new Map() };
        byIsbn.set(it.isbnId, row);
      }
      const label = it.location.label;
      let loc = row.locations.get(label);
      if (!loc) {
        loc = { location_id: it.location.id, location_label: label, ...zero() };
        row.locations.set(label, loc);
      }
      add(row.buckets, it.condition, it.quantityPhysical);
      add(loc, it.condition, it.quantityPhysical);
    }
    const sumAll = (b: Buckets) => b.vendable + b.declasse + b.perdu + b.detruit;
    const rows = [...byIsbn.values()]
      .map((r) => ({
        isbn_id: r.isbn_id, isbn13: r.isbn13, title: r.title, author: r.author,
        ...r.buckets, total: sumAll(r.buckets),
        initial_loaded: initialByIsbn.get(r.isbn_id) ?? 0,
        by_location: [...r.locations.values()].sort((a, b) => a.location_label.localeCompare(b.location_label, "fr")),
      }))
      .sort((a, b) => (a.title ?? a.isbn13).localeCompare(b.title ?? b.isbn13, "fr"));
    const totals = rows.reduce(
      (acc, r) => ({ vendable: acc.vendable + r.vendable, declasse: acc.declasse + r.declasse, perdu: acc.perdu + r.perdu, detruit: acc.detruit + r.detruit, total: acc.total + r.total }),
      { vendable: 0, declasse: 0, perdu: 0, detruit: 0, total: 0 },
    );
    return reply.send({ rows, totals });
  });

  // Stock d'un ouvrage (par manuscrit) : agrégé par ISBN et par lieu
  // (vendable / déclassé). Alimente le panneau « Stock » de la fiche manuscrit.
  fastify.get("/api/v1/manuscripts/:id/stock", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const isbns = await prisma.isbn.findMany({ where: { manuscriptId: id }, select: { id: true, isbn13: true, format: true }, orderBy: { createdAt: "asc" } });
    const isbnIds = isbns.map((i) => i.id);
    const items = isbnIds.length
      ? await prisma.stockItem.findMany({ where: { isbnId: { in: isbnIds } }, include: { location: { select: { id: true, label: true } } } })
      : [];
    const result = isbns.map((isbn) => {
      const its = items.filter((it) => it.isbnId === isbn.id);
      const locMap = new Map<string, { location_id: string; location_label: string; vendable: number; declasse: number }>();
      let vendable = 0;
      let declasse = 0;
      for (const it of its) {
        const l = locMap.get(it.locationId) ?? { location_id: it.locationId, location_label: it.location.label, vendable: 0, declasse: 0 };
        // Ce panneau montre le stock commercialisable (§24 vision logistique) :
        // vendable et déclassé. Les compartiments perdu / détruit en sont exclus.
        if (it.condition === "declasse") {
          l.declasse += it.quantityPhysical;
          declasse += it.quantityPhysical;
        } else if (it.condition === "vendable") {
          l.vendable += it.quantityPhysical;
          vendable += it.quantityPhysical;
        }
        locMap.set(it.locationId, l);
      }
      return {
        isbn_id: isbn.id, isbn13: isbn.isbn13, format: isbn.format,
        vendable, declasse, total: vendable + declasse,
        by_location: [...locMap.values()].sort((a, b) => a.location_label.localeCompare(b.location_label, "fr")),
      };
    });
    return reply.send({ has_isbn: isbns.length > 0, isbns: result });
  });

  // Rapprochement automatique de lignes « titre + quantité » (rapport d'inventaire)
  // avec les ouvrages existants (ISBN imprimés). Renvoie le meilleur ouvrage
  // apparié + un score ; les non-trouvés sont signalés pour saisie manuelle.
  fastify.post("/api/v1/stock-initial/match", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = z
      .object({ lines: z.array(z.object({ label: z.string().min(1), quantity: z.number().int().nonnegative(), damaged: z.number().int().nonnegative().optional() })).max(500) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });

    const isbns = await prisma.isbn.findMany({ where: { format: "print" }, select: { id: true, isbn13: true, manuscript: { select: { title: true } } } });
    const candidates = isbns
      .filter((i) => i.manuscript?.title)
      .map((i) => ({ isbn_id: i.id, isbn13: i.isbn13, title: i.manuscript!.title, norm: normalizeTitle(i.manuscript!.title) }));

    const results = parsed.data.lines.map((line) => {
      const n = normalizeTitle(line.label);
      let best: (typeof candidates)[number] | null = null;
      let bestScore = 0;
      for (const c of candidates) {
        const s = diceScore(n, c.norm);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      const matched = bestScore >= 0.5 ? best : null;
      return {
        label: line.label,
        quantity: line.quantity,
        damaged: line.damaged ?? 0,
        isbn_id: matched?.isbn_id ?? null,
        isbn13: matched?.isbn13 ?? null,
        matched_title: matched?.title ?? null,
        score: Math.round(bestScore * 100),
      };
    });
    return reply.send({ results });
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

    const condition = body.condition ?? "vendable";
    try {
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
            condition,
            movedBy: request.user!.id,
          },
        });
        // Effet sur le stock, compartiment par compartiment (crédit de la
        // destination différé pour un transfert ; reclassement au même lieu pour
        // perte/casse/destruction). Refuse un résultat négatif.
        await applyEffects(tx, body.isbn_id, body.print_run, physicalEffects(created));
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
    } catch (e) {
      if (e instanceof StockWouldGoNegativeError) {
        return reply.code(409).send({ code: "stock_negative", message: `Mouvement impossible : le stock deviendrait négatif (${e.resulting}). Vérifiez la quantité disponible au lieu d'origine.` });
      }
      throw e;
    }
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
        // Crédit du lieu de destination dans le même compartiment (état) que l'origine.
        await adjustStockItem(tx, movement.isbnId, movement.toLocationId!, movement.printRun, movement.quantity, 0, movement.condition);
        return tx.stockMovement.update({ where: { id }, data: { status: "completed" } });
      });
      return reply.send(updated);
    },
  );

  // MODIFIER un mouvement saisi par erreur (quantité, motif, état). Le magasinier
  // peut corriger sa saisie : le stock est recalculé atomiquement (contre-passation
  // de l'ancien effet + application du nouveau), jamais figé. Réservé aux saisies
  // manuelles non annulées ; les mouvements issus d'un autre document (vente,
  // retour…) se corrigent à la source.
  fastify.patch("/api/v1/stock-movements/:id", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = editMovementSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const m = await prisma.stockMovement.findUnique({ where: { id } });
    if (!m) return reply.code(404).send({ code: "not_found", message: "Mouvement introuvable." });
    const guard = correctableGuard(m);
    if (guard) return reply.code(409).send(guard);

    const newQty = parsed.data.quantity ?? m.quantity;
    const newCondition = parsed.data.condition ?? m.condition;
    const newReason = parsed.data.reason === undefined ? m.reason : parsed.data.reason;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // 1) Contre-passer l'effet actuel (ancienne quantité, ancien état).
        await applyEffects(tx, m.isbnId, m.printRun, physicalEffects(m).map((e) => ({ ...e, delta: -e.delta })));
        // 2) Appliquer le nouvel effet (nouvelle quantité, nouvel état).
        await applyEffects(tx, m.isbnId, m.printRun, physicalEffects({ ...m, quantity: newQty, condition: newCondition }));
        return tx.stockMovement.update({ where: { id }, data: { quantity: newQty, reason: newReason, condition: newCondition } });
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "stock_movement",
        entityId: id,
        oldValues: { quantity: m.quantity, reason: m.reason, condition: m.condition },
        newValues: { quantity: newQty, reason: newReason, condition: newCondition },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    } catch (e) {
      if (e instanceof StockWouldGoNegativeError) {
        return reply.code(409).send({ code: "stock_negative", message: `Correction impossible : le stock deviendrait négatif (${e.resulting}). Vérifiez la quantité ou les mouvements postérieurs.` });
      }
      throw e;
    }
  });

  // ANNULER un mouvement saisi par erreur (contre-passation). L'écriture n'est
  // jamais effacée (audit append-only) : elle passe au statut « annulé » et son
  // effet sur le stock est neutralisé.
  fastify.post("/api/v1/stock-movements/:id/cancel", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelMovementSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const m = await prisma.stockMovement.findUnique({ where: { id } });
    if (!m) return reply.code(404).send({ code: "not_found", message: "Mouvement introuvable." });
    const guard = correctableGuard(m);
    if (guard) return reply.code(409).send(guard);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        await applyEffects(tx, m.isbnId, m.printRun, physicalEffects(m).map((e) => ({ ...e, delta: -e.delta })));
        return tx.stockMovement.update({
          where: { id },
          data: { status: "cancelled", cancelledAt: new Date(), cancelledBy: request.user!.id, cancelReason: parsed.data.reason?.trim() || null },
        });
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "stock_movement",
        entityId: id,
        oldValues: { status: m.status },
        newValues: { status: "cancelled", cancelReason: parsed.data.reason?.trim() || null },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    } catch (e) {
      if (e instanceof StockWouldGoNegativeError) {
        return reply.code(409).send({ code: "stock_negative", message: `Annulation impossible : le stock deviendrait négatif (${e.resulting}). Les exemplaires ont probablement déjà été sortis ; enregistrez plutôt un mouvement inverse.` });
      }
      throw e;
    }
  });

  fastify.get("/api/v1/stock-movements", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const query = request.query as { isbn_id?: string };
    const movements = await prisma.stockMovement.findMany({
      where: query.isbn_id ? { isbnId: query.isbn_id } : {},
      orderBy: { movedAt: "desc" },
      take: 200,
      include: {
        isbn: { select: { isbn13: true } },
        fromLocation: { select: { label: true } },
        toLocation: { select: { label: true } },
      },
    });
    const actorNames = await resolveStockActorNames(movements.flatMap((m) => [m.movedBy, m.cancelledBy]));
    return reply.send(movements.map((m) => ({
      ...m,
      isbn13: m.isbn?.isbn13 ?? null,
      from_location_label: m.fromLocation?.label ?? null,
      to_location_label: m.toLocation?.label ?? null,
      moved_by_name: m.movedBy ? actorNames.get(m.movedBy) ?? null : null,
      cancelled_by_name: m.cancelledBy ? actorNames.get(m.cancelledBy) ?? null : null,
      // Le magasinier ne corrige que ses saisies manuelles non annulées.
      editable: m.status !== "cancelled" && !m.referenceType && MANUAL_MOVEMENT_TYPES.includes(m.type),
    })));
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
  // Liste des campagnes d'inventaire avec avancement (comptées / écarts / à
  // recompter) — pour le suivi façon rapport d'inventaire.
  fastify.get("/api/v1/inventories", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const invs = await prisma.inventory.findMany({
      orderBy: { openedAt: "desc" },
      take: 100,
      include: {
        location: { select: { label: true } },
        lines: { select: { countedQty: true, countedDamaged: true, variance: true, recountRequired: true, adjustmentMovementId: true } },
      },
    });
    return reply.send(
      invs.map((inv) => {
        const total = inv.lines.length;
        const counted = inv.lines.filter((l) => l.countedQty !== null).length;
        const variance = inv.lines.filter((l) => l.variance !== null && l.variance !== 0).length;
        const damaged = inv.lines.filter((l) => (l.countedDamaged ?? 0) > 0).length;
        const recount = inv.lines.filter((l) => l.recountRequired).length;
        const pendingAdjust = inv.lines.filter((l) => !l.adjustmentMovementId && ((l.variance !== null && l.variance !== 0) || (l.countedDamaged ?? 0) > 0)).length;
        return {
          id: inv.id, type: inv.type, blind: inv.blind, status: inv.status,
          location_label: inv.location?.label ?? null, opened_at: inv.openedAt, closed_at: inv.closedAt,
          total_lines: total, counted_lines: counted, variance_lines: variance, damaged_lines: damaged, recount_lines: recount, pending_adjust: pendingAdjust,
        };
      }),
    );
  });

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
    const inventory = await prisma.inventory.findUnique({
      where: { id },
      include: {
        location: { select: { label: true } },
        lines: { include: { isbn: { select: { isbn13: true, manuscript: { select: { title: true } } } } }, orderBy: { id: "asc" } },
      },
    });
    if (!inventory) {
      return reply.code(404).send({ code: "not_found", message: "Inventaire introuvable." });
    }
    // Titre + ISBN pour l'affichage ; masquage à l'aveugle du théorique conservé.
    const lines = inventory.lines.map(({ isbn, ...line }) => ({
      ...maskBlindLine(line, inventory),
      title: isbn.manuscript?.title ?? null,
      isbn13: isbn.isbn13,
    }));
    return reply.send({ ...inventory, location_label: inventory.location?.label ?? null, lines });
  });

  fastify.patch(
    "/api/v1/inventory-lines/:id",
    { preHandler: requirePermission("stock", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ counted_qty: z.number().int().nonnegative(), counted_damaged: z.number().int().nonnegative().optional() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const damaged = parsed.data.counted_damaged ?? 0;
      if (damaged > parsed.data.counted_qty) {
        return reply.code(400).send({ code: "damaged_exceeds", message: "Le nombre d'exemplaires abîmés ne peut pas dépasser la quantité comptée." });
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
        data: { countedQty: parsed.data.counted_qty, countedDamaged: damaged, variance, recountRequired },
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
      const damaged = line.countedDamaged ?? 0;
      if (line.countedQty === null || line.variance === null || (line.variance === 0 && damaged === 0)) {
        return reply.code(409).send({ code: "no_variance", message: "Aucun écart ni exemplaire abîmé à régulariser sur cette ligne." });
      }
      if (line.adjustmentMovementId) {
        return reply.code(409).send({ code: "already_adjusted", message: "Cette ligne a déjà été régularisée." });
      }
      if (!line.inventory.locationId) {
        return reply.code(409).send({ code: "location_missing", message: "L'inventaire n'a pas de lieu associé." });
      }

      const variance = line.variance;
      const locationId = line.inventory.locationId;
      const updated = await prisma.$transaction(async (tx) => {
        let primaryMovementId: string | null = null;
        // 1) Régularisation de l'écart quantitatif (stock vendable).
        if (variance !== 0) {
          const movement = await tx.stockMovement.create({
            data: {
              type: "inventory_adjustment", isbnId: line.isbnId, printRun: 0,
              fromLocationId: variance < 0 ? locationId : undefined,
              toLocationId: variance > 0 ? locationId : undefined,
              quantity: Math.abs(variance),
              reason: `Régularisation d'inventaire (écart ${variance})`,
              referenceType: "inventory_line", referenceId: line.id, status: "completed", movedBy: request.user!.id,
            },
          });
          await adjustStockItem(tx, line.isbnId, locationId, 0, variance);
          primaryMovementId = movement.id;
        }
        // 2) Déclassement des exemplaires abîmés : vendable → déclassé (même lieu).
        if (damaged > 0) {
          const dmov = await tx.stockMovement.create({
            data: {
              type: "inventory_adjustment", isbnId: line.isbnId, printRun: 0,
              fromLocationId: locationId, toLocationId: locationId, quantity: damaged,
              reason: `Déclassement de ${damaged} exemplaire(s) abîmé(s) (inventaire)`,
              referenceType: "inventory_line", referenceId: line.id, status: "completed", movedBy: request.user!.id,
            },
          });
          await adjustStockItem(tx, line.isbnId, locationId, 0, -damaged, 0, "vendable");
          await adjustStockItem(tx, line.isbnId, locationId, 0, damaged, 0, "declasse");
          if (!primaryMovementId) primaryMovementId = dmov.id;
        }
        return tx.inventoryLine.update({
          where: { id },
          data: { adjustmentMovementId: primaryMovementId, recountRequired: false },
        });
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "inventory_line",
        entityId: id,
        newValues: { variance, damaged },
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
      (line) =>
        !line.adjustmentMovementId &&
        ((line.variance !== null && line.variance !== 0) || (line.countedDamaged ?? 0) > 0),
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

  // ————————————————————————————————————————————————————————————————
  // STOCK COMMERCIAL INDIVIDUEL (§10)
  // Chaque commercial dispose d'un lieu de stock propre. Une remise magasin →
  // commercial n'est PAS une vente : c'est un transfert de responsabilité. Le
  // système suit reçus / vendus / retournés / offerts / pertes / détenus, et
  // affiche les exemplaires « à justifier » (ce que le commercial détient encore).
  // ————————————————————————————————————————————————————————————————

  const handoverSchema = z.object({
    isbn_id: z.string().uuid(),
    print_run: z.number().int().nonnegative().default(0),
    quantity: z.number().int().positive(),
    location_id: z.string().uuid(), // magasin source (remise) ou destination (retour)
    reason: z.string().optional(),
  });

  // Lieu de stock d'un commercial, créé à la première remise.
  async function getOrCreateCommercialLocation(userId: string) {
    const existing = await prisma.stockLocation.findFirst({ where: { commercialUserId: userId, type: "stock_commercial" } });
    if (existing) return existing;
    const names = await resolveStockActorNames([userId]);
    return prisma.stockLocation.create({ data: { type: "stock_commercial", label: `Stock commercial — ${names.get(userId) ?? "commercial"}`, commercialUserId: userId } });
  }

  // Déplace des exemplaires entre un magasin et le lieu du commercial (les deux
  // côtés ajustés dans une même transaction, effet immédiat, refus si négatif).
  async function moveBetween(isbnId: string, printRun: number, quantity: number, fromId: string, toId: string, type: StockMovementType, userId: string, reason: string, ip: string) {
    return prisma.$transaction(async (tx) => {
      const debited = await adjustStockItem(tx, isbnId, fromId, printRun, -quantity, 0, "vendable");
      if (debited.quantityPhysical < 0) throw new StockWouldGoNegativeError(fromId, debited.quantityPhysical);
      await adjustStockItem(tx, isbnId, toId, printRun, quantity, 0, "vendable");
      const mv = await tx.stockMovement.create({
        data: { type, isbnId, printRun, fromLocationId: fromId, toLocationId: toId, quantity, reason, status: "completed", condition: "vendable", movedBy: userId },
      });
      await writeAuditLog({ userId, action: "create", entityType: "stock_movement", entityId: mv.id, newValues: { type, isbnId, quantity, from: fromId, to: toId }, ipAddress: ip });
      return mv;
    });
  }

  // État du stock d'un commercial : agrégats par catégorie + détenus (à justifier).
  async function commercialStockReport(locationId: string) {
    const movements = await prisma.stockMovement.findMany({ where: { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }], status: { not: "cancelled" } } });
    let recus = 0, vendus = 0, retournes = 0, offerts = 0, pertes = 0;
    const OFFERTS: StockMovementType[] = ["author_copy", "press_copy", "promotional_out", "free_out", "event_out", "institutional_out"];
    const PERTES: StockMovementType[] = ["loss", "damage", "destruction", "pulping"];
    for (const m of movements) {
      if (m.toLocationId === locationId) recus += m.quantity;
      else if (m.fromLocationId === locationId) {
        if (m.type === "sale_out") vendus += m.quantity;
        else if (m.type === "commercial_return" || m.type === "transfer") retournes += m.quantity;
        else if (OFFERTS.includes(m.type)) offerts += m.quantity;
        else if (PERTES.includes(m.type)) pertes += m.quantity;
        else retournes += m.quantity; // toute autre sortie assimilée à une restitution
      }
    }
    const items = await prisma.stockItem.findMany({ where: { locationId } });
    const detenus = items.reduce((s, it) => s + it.quantityPhysical, 0);
    return { recus, vendus, retournes, offerts, pertes, detenus, a_justifier: detenus };
  }

  // Remise d'exemplaires à un commercial (magasin → commercial). Réservé à la saisie stock.
  fastify.post("/api/v1/commercial-stock/:userId/handover", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const parsed = handoverSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return reply.code(404).send({ code: "not_found", message: "Commercial introuvable." });
    const loc = await getOrCreateCommercialLocation(userId);
    try {
      const mv = await moveBetween(parsed.data.isbn_id, parsed.data.print_run, parsed.data.quantity, parsed.data.location_id, loc.id, "transfer", request.user!.id, parsed.data.reason || "Remise au commercial", request.ip);
      return reply.code(201).send(mv);
    } catch (e) {
      if (e instanceof StockWouldGoNegativeError) return reply.code(409).send({ code: "stock_negative", message: `Remise impossible : le magasin ne détient pas ${parsed.data.quantity} exemplaire(s) disponible(s).` });
      throw e;
    }
  });

  // Retour d'exemplaires par un commercial (commercial → magasin).
  fastify.post("/api/v1/commercial-stock/:userId/return", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const parsed = handoverSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const loc = await getOrCreateCommercialLocation(userId);
    try {
      const mv = await moveBetween(parsed.data.isbn_id, parsed.data.print_run, parsed.data.quantity, loc.id, parsed.data.location_id, "commercial_return", request.user!.id, parsed.data.reason || "Retour du commercial", request.ip);
      return reply.code(201).send(mv);
    } catch (e) {
      if (e instanceof StockWouldGoNegativeError) return reply.code(409).send({ code: "stock_negative", message: `Retour impossible : le commercial ne détient pas ${parsed.data.quantity} exemplaire(s).` });
      throw e;
    }
  });

  // État de TOUS les commerciaux — responsable commercial / direction / admin stock.
  fastify.get(
    "/api/v1/commercial-stock",
    { preHandler: requireAnyPermission([{ module: "commercial", action: "validation" }, { module: "commercial", action: "administration" }, { module: "direction", action: "consultation" }, { module: "stock", action: "administration" }]) },
    async (_request, reply) => {
      const locations = await prisma.stockLocation.findMany({ where: { type: "stock_commercial", commercialUserId: { not: null } } });
      const names = await resolveStockActorNames(locations.map((l) => l.commercialUserId));
      const rows = await Promise.all(locations.map(async (l) => ({
        user_id: l.commercialUserId,
        commercial_name: l.commercialUserId ? names.get(l.commercialUserId) ?? null : null,
        location_id: l.id,
        ...(await commercialStockReport(l.id)),
      })));
      rows.sort((a, b) => b.a_justifier - a.a_justifier);
      const total = rows.reduce((t, r) => ({ recus: t.recus + r.recus, vendus: t.vendus + r.vendus, retournes: t.retournes + r.retournes, offerts: t.offerts + r.offerts, pertes: t.pertes + r.pertes, detenus: t.detenus + r.detenus, a_justifier: t.a_justifier + r.a_justifier }), { recus: 0, vendus: 0, retournes: 0, offerts: 0, pertes: 0, detenus: 0, a_justifier: 0 });
      return reply.send({ reps: rows, total });
    },
  );

  // Liste des commerciaux (pour la remise) — accessible à la saisie stock, sans
  // exiger la permission d'administration des utilisateurs.
  fastify.get("/api/v1/commercial-stock/commercials", { preHandler: requirePermission("stock", "saisie") }, async (_request, reply) => {
    const userRoles = await prisma.userRole.findMany({
      where: { revokedAt: null, role: { code: { in: ["COMMERCIAL", "RESP_COMMERCIAL"] } }, user: { deletedAt: null, status: "active" } },
      select: { userId: true },
    });
    const ids = [...new Set(userRoles.map((u) => u.userId))];
    const names = await resolveStockActorNames(ids);
    return reply.send(ids.map((id) => ({ id, name: names.get(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name)));
  });

  // État du commercial connecté (son propre stock à justifier).
  fastify.get("/api/v1/commercial-stock/mine", { preHandler: requirePermission("commercial", "consultation") }, async (request, reply) => {
    const loc = await prisma.stockLocation.findFirst({ where: { commercialUserId: request.user!.id, type: "stock_commercial" } });
    if (!loc) return reply.send({ location_id: null, recus: 0, vendus: 0, retournes: 0, offerts: 0, pertes: 0, detenus: 0, a_justifier: 0 });
    return reply.send({ location_id: loc.id, ...(await commercialStockReport(loc.id)) });
  });
}
