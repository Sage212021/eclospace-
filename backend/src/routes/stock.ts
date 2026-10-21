import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StockLocationType, StockMovementType, StockMovementStatus, StockItemCondition, InventoryType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyRole } from "../lib/notify.js";
import { adjustStockItem, availableQuantity } from "../lib/stock.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import { nextManuscriptNumber } from "../lib/manuscriptNumber.js";
import { findDuplicateManuscript, duplicateMessage } from "../lib/manuscriptDuplicate.js";

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
  // Retours (événement, promotion, autre) : entrée dans le magasin.
  event_return: { from: false, to: true },
  promotional_return: { from: false, to: true },
  other_return: { from: false, to: true },
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
  "event_return",
  "promotional_return",
  "other_return",
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
  // Bénéficiaire / origine (facultatif) : à qui / d'où (don, presse, commercial…).
  beneficiary: z.string().max(200).optional(),
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
            beneficiary: body.beneficiary,
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
      // Historique élargi pour permettre le filtrage avancé et l'export côté client.
      take: 1000,
      include: {
        isbn: { select: { isbn13: true } },
        fromLocation: { select: { label: true } },
        toLocation: { select: { label: true } },
      },
    });
    const actorNames = await resolveStockActorNames(movements.flatMap((m) => [m.movedBy, m.cancelledBy]));
    // Justificatifs rattachés (GED) : un seul aller-retour pour toute la page.
    const withJustif = movements.length
      ? new Set(
          (
            await prisma.document.findMany({
              where: { entityType: "stock_movement", entityId: { in: movements.map((m) => m.id) }, category: "justificatif_stock", deletedAt: null },
              select: { entityId: true },
            })
          ).map((d) => d.entityId),
        )
      : new Set<string>();
    return reply.send(movements.map((m) => ({
      ...m,
      isbn13: m.isbn?.isbn13 ?? null,
      from_location_label: m.fromLocation?.label ?? null,
      to_location_label: m.toLocation?.label ?? null,
      moved_by_name: m.movedBy ? actorNames.get(m.movedBy) ?? null : null,
      cancelled_by_name: m.cancelledBy ? actorNames.get(m.cancelledBy) ?? null : null,
      has_justification: withJustif.has(m.id),
      // Le magasinier ne corrige que ses saisies manuelles non annulées.
      editable: m.status !== "cancelled" && !m.referenceType && MANUAL_MOVEMENT_TYPES.includes(m.type),
    })));
  });

  // --- Justificatif d'un mouvement (photo, PV, constat — §6) ---
  // Rattaché via la GED (Document/DocumentVersion, catégorie « justificatif_stock »),
  // comme la preuve de livraison. Un seul justificatif par mouvement (versionné).
  fastify.post("/api/v1/stock-movements/:id/justification", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const movement = await prisma.stockMovement.findUnique({ where: { id } });
    if (!movement) return reply.code(404).send({ code: "not_found", message: "Mouvement introuvable." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });

    const stored = await storeFile(buffer, `justificatif-stock-${id}-${file.filename}`);
    let doc = await prisma.document.findFirst({ where: { entityType: "stock_movement", entityId: id, category: "justificatif_stock", deletedAt: null } });
    if (!doc) {
      doc = await prisma.document.create({
        data: { entityType: "stock_movement", entityId: id, category: "justificatif_stock", confidentiality: "interne", title: `Justificatif mouvement de stock`, createdBy: request.user!.id, updatedBy: request.user!.id },
      });
    }
    const last = await prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: "desc" } });
    const version = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: (last?.versionNumber ?? 0) + 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: file.mimetype, sha256Hash: stored.sha256Hash, changeSummary: `Justificatif déposé (${file.filename})`, uploadedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: last ? "update" : "create", entityType: "document_version", entityId: version.id, newValues: { stock_movement_justification: true, movementId: id, versionNumber: version.versionNumber }, ipAddress: request.ip });
    return reply.code(201).send({ id: doc.id, version_id: version.id, has_justification: true });
  });

  fastify.get("/api/v1/stock-movements/:id/justification", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await prisma.document.findFirst({
      where: { entityType: "stock_movement", entityId: id, category: "justificatif_stock", deletedAt: null },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const version = doc?.versions[0];
    if (!version) return reply.code(404).send({ code: "not_found", message: "Aucun justificatif rattaché à ce mouvement." });
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  // --- Tableau de bord du stock (§16) : indicateurs de pilotage ---
  fastify.get("/api/v1/stock-dashboard", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [vendableItems, defaultThreshold, monthMoves, reappros] = await Promise.all([
      prisma.stockItem.findMany({ where: { condition: "vendable" }, select: { isbnId: true, quantityPhysical: true, quantityReserved: true, alertThreshold: true, outOfStockThreshold: true } }),
      isbnStockAlertThreshold(),
      prisma.stockMovement.findMany({ where: { status: { not: "cancelled" }, movedAt: { gte: monthStart, lt: monthEnd } }, select: { type: true, quantity: true, fromLocationId: true, toLocationId: true, reason: true } }),
      prisma.replenishment.count({ where: { status: { in: ["requested", "approved", "in_progress", "partially_received"] } } }),
    ]);

    // Stock disponible total (vendable) + ouvrages sous seuil (par ISBN).
    let stockTotal = 0;
    const availByIsbn = new Map<string, number>();
    const thresholdByIsbn = new Map<string, number>();
    const outByIsbn = new Map<string, number>();
    for (const it of vendableItems) {
      const avail = Math.max(0, it.quantityPhysical - it.quantityReserved);
      stockTotal += avail;
      availByIsbn.set(it.isbnId, (availByIsbn.get(it.isbnId) ?? 0) + avail);
      thresholdByIsbn.set(it.isbnId, Math.max(thresholdByIsbn.get(it.isbnId) ?? 0, it.alertThreshold ?? defaultThreshold));
      outByIsbn.set(it.isbnId, Math.max(outByIsbn.get(it.isbnId) ?? 0, it.outOfStockThreshold));
    }
    let lowStock = 0;
    for (const [isbnId, avail] of availByIsbn) if (avail <= (thresholdByIsbn.get(isbnId) ?? defaultThreshold)) lowStock += 1;

    // Mouvements du mois : entrées, sorties, destructions/détériorations, dons, écarts.
    let entries = 0, exits = 0, destroyedDamaged = 0, offered = 0, variances = 0;
    for (const m of monthMoves) {
      const isInitial = m.type === "inventory_adjustment" && (m.reason ?? "").startsWith("Chargement inventaire initial");
      const isIn = !!m.toLocationId && !m.fromLocationId;
      const isOut = !!m.fromLocationId && !m.toLocationId;
      if (isIn) entries += m.quantity;
      else if (isOut) exits += m.quantity;
      if (m.type === "destruction" || m.type === "pulping" || m.type === "damage") destroyedDamaged += m.quantity;
      if (m.type === "free_out") offered += m.quantity;
      if (m.type === "inventory_adjustment" && !isInitial) variances += m.quantity;
    }

    return reply.send({
      stock_total: stockTotal,
      low_stock_count: lowStock,
      replenishments_in_progress: reappros,
      entries_month: entries,
      exits_month: exits,
      destroyed_damaged_month: destroyedDamaged,
      offered_month: offered,
      inventory_variances_month: variances,
      month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    });
  });

  // --- Fluctuation par catégorie (§14) : entrées / sorties par type sur une période ---
  fastify.get("/api/v1/stock-fluctuation", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const q = request.query as { from?: string; to?: string; isbn_id?: string; location_id?: string };
    const from = q.from && /^\d{4}-\d{2}-\d{2}/.test(q.from) ? new Date(q.from + "T00:00:00.000Z") : undefined;
    const to = q.to && /^\d{4}-\d{2}-\d{2}/.test(q.to) ? new Date(q.to + "T00:00:00.000Z") : undefined;
    const moves = await prisma.stockMovement.findMany({
      where: {
        status: { not: "cancelled" },
        ...(from || to ? { movedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
        ...(q.isbn_id ? { isbnId: q.isbn_id } : {}),
        ...(q.location_id ? { OR: [{ fromLocationId: q.location_id }, { toLocationId: q.location_id }] } : {}),
      },
      select: { type: true, quantity: true, fromLocationId: true, toLocationId: true },
    });
    const inByType = new Map<string, number>();
    const outByType = new Map<string, number>();
    for (const m of moves) {
      const isIn = !!m.toLocationId && !m.fromLocationId;
      const isOut = !!m.fromLocationId && !m.toLocationId;
      if (isIn) inByType.set(m.type, (inByType.get(m.type) ?? 0) + m.quantity);
      else if (isOut) outByType.set(m.type, (outByType.get(m.type) ?? 0) + m.quantity);
      // transferts (from+to) : internes, non comptés.
    }
    const toRows = (map: Map<string, number>) => [...map.entries()].map(([type, quantity]) => ({ type, quantity })).sort((a, b) => b.quantity - a.quantity);
    const entries = toRows(inByType);
    const exits = toRows(outByType);
    return reply.send({
      from: q.from ?? null,
      to: q.to ?? null,
      entries,
      exits,
      total_in: entries.reduce((s, r) => s + r.quantity, 0),
      total_out: exits.reduce((s, r) => s + r.quantity, 0),
    });
  });

  // --- Fluctuation par ouvrage (§13) : initial + entrées − sorties ± ajustements = disponible ---
  fastify.get("/api/v1/stock-fluctuation-by-book", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const [moves, vendableItems, defaultThreshold] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { status: { not: "cancelled" } },
        select: { isbnId: true, type: true, quantity: true, fromLocationId: true, toLocationId: true, reason: true, isbn: { select: { isbn13: true, manuscript: { select: { title: true, workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { firstName: true, lastName: true } } } } } } } } },
      }),
      prisma.stockItem.findMany({ where: { condition: "vendable" }, select: { isbnId: true, quantityPhysical: true, quantityReserved: true, alertThreshold: true, outOfStockThreshold: true } }),
      isbnStockAlertThreshold(),
    ]);

    type Row = { isbn_id: string; isbn13: string; title: string | null; author: string | null; initial: number; entries: number; exits: number; adjustments: number; available: number; threshold: number; out_threshold: number };
    const rows = new Map<string, Row>();
    const ensure = (isbnId: string, isbn13: string, title: string | null, author: string | null): Row => {
      let r = rows.get(isbnId);
      if (!r) { r = { isbn_id: isbnId, isbn13, title, author, initial: 0, entries: 0, exits: 0, adjustments: 0, available: 0, threshold: defaultThreshold, out_threshold: 0 }; rows.set(isbnId, r); }
      return r;
    };
    for (const m of moves) {
      const c = m.isbn?.manuscript?.workContributors?.[0]?.partner;
      const author = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null : null;
      const r = ensure(m.isbnId, m.isbn?.isbn13 ?? "", m.isbn?.manuscript?.title ?? null, author);
      const isInitial = m.type === "inventory_adjustment" && (m.reason ?? "").startsWith("Chargement inventaire initial");
      const isIn = !!m.toLocationId && !m.fromLocationId;
      const isOut = !!m.fromLocationId && !m.toLocationId;
      if (isInitial) { r.initial += m.quantity; }
      else if (m.type === "inventory_adjustment") { r.adjustments += isIn ? m.quantity : isOut ? -m.quantity : 0; }
      else if (isIn) { r.entries += m.quantity; }
      else if (isOut) { r.exits += m.quantity; }
      // transferts : internes, sans effet sur le total de l'ouvrage.
    }
    for (const it of vendableItems) {
      const r = rows.get(it.isbnId);
      if (!r) continue;
      r.available += Math.max(0, it.quantityPhysical - it.quantityReserved);
      r.threshold = Math.max(r.threshold, it.alertThreshold ?? defaultThreshold);
      r.out_threshold = Math.max(r.out_threshold, it.outOfStockThreshold);
    }
    const state = (r: Row): "rupture" | "faible" | "normal" => (r.available <= r.out_threshold ? "rupture" : r.available <= r.threshold ? "faible" : "normal");
    const out = [...rows.values()]
      .map((r) => ({ ...r, state: state(r) }))
      .sort((a, b) => (a.title ?? a.isbn13).localeCompare(b.title ?? b.isbn13, "fr"));
    return reply.send({ rows: out });
  });

  // ————————————————————————————————————————————————————————————————
  // TABLEAU RÉCAPITULATIF DU STOCK PAR OUVRAGE (cahier §4, §31) + POLITIQUE
  // DE STOCK PAR OUVRAGE (§18). Tous les CHIFFRES sont CALCULÉS depuis les
  // données réelles : mouvements (flux), stock_items (état), consignations
  // (dépôt), livraisons expédiées non reçues (transit). Seuls les SEUILS et le
  // stock cible viennent d'un paramétrage (StockPolicy). Aucune valeur libre.
  // ————————————————————————————————————————————————————————————————

  // Mouvements considérés comme des RETOURS (entrées d'exemplaires revenus).
  const RETURN_TYPES = new Set<StockMovementType>(["consignment_return", "customer_return", "commercial_return", "event_return", "promotional_return", "other_return"]);
  // Mouvements d'ENTRÉE « fabrication / fournisseur » (hors retours, hors initial).
  const ENTRY_TYPES = new Set<StockMovementType>(["production_in", "supplier_in"]);

  type OverviewRow = {
    isbn_id: string; isbn13: string; title: string | null; author: string | null;
    stock_initial: number; entrees: number; retours: number; sorties: number; ajustements: number;
    stock_physique: number; reserve: number; disponible: number; defectueux: number;
    en_depot: number; en_transit: number;
    seuil_alerte: number; seuil_reappro: number | null; stock_cible: number | null; qte_min_reimpression: number | null;
    qte_a_reapprovisionner: number | null; statut: "normal" | "alerte" | "reappro" | "rupture";
    // Rotation (Lot C, §23) : ventes réelles (mouvements de vente) sur les
    // fenêtres glissantes, cadence mensuelle retenue, couverture en mois, et
    // proposition de réappro « intelligente » explicable (§22).
    ventes_1m: number; ventes_3m: number; ventes_6m: number; ventes_12m: number;
    ventes_par_mois: number; couverture_mois: number | null;
    reappro_conseille: number; reappro_explication: string;
  };

  async function computeStockOverview(): Promise<{ rows: OverviewRow[]; totals: { stock_physique: number; disponible: number; reserve: number; en_depot: number; en_transit: number; defectueux: number }; counts: { sous_seuil: number; a_reapprovisionner: number; rupture: number } }> {
    const [moves, items, consignments, transitDeliveries, policies, defaultThreshold] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { status: { not: "cancelled" } },
        select: { isbnId: true, type: true, quantity: true, movedAt: true, fromLocationId: true, toLocationId: true, reason: true, isbn: { select: { isbn13: true, manuscript: { select: { title: true, workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { firstName: true, lastName: true } } } } } } } } },
      }),
      prisma.stockItem.findMany({ select: { isbnId: true, condition: true, quantityPhysical: true, quantityReserved: true } }),
      prisma.consignment.findMany({ where: { status: "active" }, select: { isbnId: true, quantityDeposited: true, statements: { select: { quantitySold: true } } } }),
      prisma.delivery.findMany({ where: { shippedAt: { not: null }, deliveredAt: null }, select: { lines: { select: { isbnId: true, quantity: true } } } }),
      prisma.stockPolicy.findMany(),
      isbnStockAlertThreshold(),
    ]);

    const map = new Map<string, OverviewRow>();
    const ensure = (isbnId: string, isbn13: string, title: string | null, author: string | null): OverviewRow => {
      let r = map.get(isbnId);
      if (!r) {
        r = { isbn_id: isbnId, isbn13, title, author, stock_initial: 0, entrees: 0, retours: 0, sorties: 0, ajustements: 0, stock_physique: 0, reserve: 0, disponible: 0, defectueux: 0, en_depot: 0, en_transit: 0, seuil_alerte: defaultThreshold, seuil_reappro: null, stock_cible: null, qte_min_reimpression: null, qte_a_reapprovisionner: null, statut: "normal", ventes_1m: 0, ventes_3m: 0, ventes_6m: 0, ventes_12m: 0, ventes_par_mois: 0, couverture_mois: null, reappro_conseille: 0, reappro_explication: "" };
        map.set(isbnId, r);
      }
      return r;
    };

    // FLUX (mouvements) : d'où vient le stock, ce qui est sorti, revenu, ajusté.
    for (const m of moves) {
      const c = m.isbn?.manuscript?.workContributors?.[0]?.partner;
      const author = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null : null;
      const r = ensure(m.isbnId, m.isbn?.isbn13 ?? "", m.isbn?.manuscript?.title ?? null, author);
      const isInitial = m.type === "inventory_adjustment" && (m.reason ?? "").startsWith("Chargement inventaire initial");
      const isIn = !!m.toLocationId && !m.fromLocationId;
      const isOut = !!m.fromLocationId && !m.toLocationId;
      if (isInitial) r.stock_initial += m.quantity;
      else if (m.type === "inventory_adjustment") r.ajustements += isIn ? m.quantity : isOut ? -m.quantity : 0;
      else if (RETURN_TYPES.has(m.type)) r.retours += m.quantity;
      else if (ENTRY_TYPES.has(m.type)) r.entrees += m.quantity;
      else if (isOut) r.sorties += m.quantity;
      else if (isIn) r.entrees += m.quantity;
      // transfer : interne, sans effet sur le total de l'ouvrage.
    }

    // ÉTAT réel (stock_items) : présent = vendable + déclassé ; disponible =
    // vendable − réservé ; défectueux = déclassé (présent mais non vendable).
    // perdu / détruit = pierres tombales (hors stock présent).
    for (const it of items) {
      const r = map.get(it.isbnId);
      if (!r) continue; // un item sans aucun mouvement est improbable (créé par mvt)
      if (it.condition === "vendable") { r.stock_physique += it.quantityPhysical; r.reserve += it.quantityReserved; r.disponible += it.quantityPhysical - it.quantityReserved; }
      else if (it.condition === "declasse") { r.stock_physique += it.quantityPhysical; r.defectueux += it.quantityPhysical; }
    }
    // Un ISBN peut avoir des items mais aucun mouvement listé (rare) : on les crée.
    for (const it of items) {
      if (map.has(it.isbnId)) continue;
      const r = ensure(it.isbnId, "", null, null);
      if (it.condition === "vendable") { r.stock_physique += it.quantityPhysical; r.reserve += it.quantityReserved; r.disponible += it.quantityPhysical - it.quantityReserved; }
      else if (it.condition === "declasse") { r.stock_physique += it.quantityPhysical; r.defectueux += it.quantityPhysical; }
    }

    // EN DÉPÔT (consignations actives) : déposé − vendu (relevés).
    for (const cons of consignments) {
      const r = map.get(cons.isbnId);
      if (!r) continue;
      const sold = cons.statements.reduce((s, st) => s + st.quantitySold, 0);
      r.en_depot += Math.max(0, cons.quantityDeposited - sold);
    }
    // EN TRANSIT : livraisons expédiées, réception non encore enregistrée.
    for (const d of transitDeliveries) for (const l of d.lines) { const r = map.get(l.isbnId); if (r) r.en_transit += l.quantity; }

    // POLITIQUE (seuils, cible) + dérivés (qté à réappro, statut à 4 niveaux).
    const policyByIsbn = new Map(policies.map((p) => [p.isbnId, p]));
    for (const r of map.values()) {
      const p = policyByIsbn.get(r.isbn_id);
      r.seuil_alerte = p?.alertThreshold ?? defaultThreshold;
      r.seuil_reappro = p?.reorderThreshold ?? null;
      r.stock_cible = p?.targetStock ?? null;
      r.qte_min_reimpression = p?.minReprintQty ?? null;
      if (r.stock_cible != null) {
        const raw = r.stock_cible - r.disponible;
        r.qte_a_reapprovisionner = raw <= 0 ? 0 : Math.max(raw, r.qte_min_reimpression ?? 0);
      }
      r.statut = r.disponible <= 0 ? "rupture"
        : r.seuil_reappro != null && r.disponible <= r.seuil_reappro ? "reappro"
        : r.disponible <= r.seuil_alerte ? "alerte"
        : "normal";
    }

    // ROTATION (Lot C, §22/§23) : ventes RÉELLES (mouvements de vente) sur des
    // fenêtres glissantes, cadence mensuelle, couverture, et proposition de
    // réappro « intelligente » — toujours EXPLICABLE (une phrase de calcul).
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const m of moves) {
      if (m.type !== "sale_out") continue;
      const r = map.get(m.isbnId);
      if (!r) continue;
      const ageDays = (now - m.movedAt.getTime()) / DAY;
      if (ageDays < 0) continue;
      if (ageDays <= 30) r.ventes_1m += m.quantity;
      if (ageDays <= 90) r.ventes_3m += m.quantity;
      if (ageDays <= 180) r.ventes_6m += m.quantity;
      if (ageDays <= 365) r.ventes_12m += m.quantity;
    }
    const round1 = (n: number) => Math.round(n * 10) / 10;
    for (const r of map.values()) {
      // Cadence mensuelle : moyenne sur 3 mois, à défaut 6 puis 12 (repli si
      // l'ouvrage est récent ou peu vendu récemment).
      const rate = r.ventes_3m > 0 ? r.ventes_3m / 3 : r.ventes_6m > 0 ? r.ventes_6m / 6 : r.ventes_12m > 0 ? r.ventes_12m / 12 : 0;
      r.ventes_par_mois = round1(rate);
      r.couverture_mois = rate > 0 ? round1(r.disponible / rate) : null;

      // Réappro conseillé : couvrir le délai de réimpression + une marge, à
      // partir de la cadence de vente ; on déduit le disponible et le transit.
      const policy = policyByIsbn.get(r.isbn_id);
      const leadDays = policy?.reprintLeadDays ?? null;
      const lead = leadDays != null ? Math.max(1, Math.ceil(leadDays / 30)) : 1; // mois
      const marge = 2; // mois de sécurité
      if (rate > 0) {
        const besoin = Math.round(rate * (lead + marge));
        let conseil = Math.max(0, besoin - r.disponible - r.en_transit);
        if (conseil > 0 && r.qte_min_reimpression != null && conseil < r.qte_min_reimpression) conseil = r.qte_min_reimpression;
        r.reappro_conseille = conseil;
        r.reappro_explication = conseil > 0
          ? `Ventes ~${round1(rate)}/mois × ${lead + marge} mois (délai ${lead} + marge ${marge}) = ${besoin}, − ${r.disponible} dispo${r.en_transit ? ` − ${r.en_transit} en transit` : ""} = ${Math.max(0, besoin - r.disponible - r.en_transit)}${conseil !== Math.max(0, besoin - r.disponible - r.en_transit) ? ` → ${conseil} (réimpression mini)` : ""}.`
          : `Ventes ~${round1(rate)}/mois : ${r.disponible} disponible${r.en_transit ? ` + ${r.en_transit} en transit` : ""} couvre ${lead + marge} mois → pas de réappro nécessaire.`;
      } else if (r.stock_cible != null) {
        // Pas d'historique de ventes : on retombe sur la règle simple (§20).
        const raw = r.stock_cible - r.disponible;
        r.reappro_conseille = raw <= 0 ? 0 : Math.max(raw, r.qte_min_reimpression ?? 0);
        r.reappro_explication = raw <= 0
          ? `Pas de ventes récentes ; stock cible ${r.stock_cible} déjà atteint (${r.disponible} dispo).`
          : `Pas de ventes récentes : stock cible ${r.stock_cible} − ${r.disponible} dispo = ${raw}${r.reappro_conseille !== raw ? ` → ${r.reappro_conseille} (réimpression mini)` : ""}.`;
      } else {
        r.reappro_conseille = 0;
        r.reappro_explication = "Pas de ventes récentes ni de stock cible réglé : aucune proposition.";
      }
    }

    const rows = [...map.values()].sort((a, b) => (a.title ?? a.isbn13).localeCompare(b.title ?? b.isbn13, "fr"));
    const totals = rows.reduce((acc, r) => ({ stock_physique: acc.stock_physique + r.stock_physique, disponible: acc.disponible + r.disponible, reserve: acc.reserve + r.reserve, en_depot: acc.en_depot + r.en_depot, en_transit: acc.en_transit + r.en_transit, defectueux: acc.defectueux + r.defectueux }), { stock_physique: 0, disponible: 0, reserve: 0, en_depot: 0, en_transit: 0, defectueux: 0 });
    const counts = {
      sous_seuil: rows.filter((r) => r.statut === "alerte").length,
      a_reapprovisionner: rows.filter((r) => r.statut === "reappro").length,
      rupture: rows.filter((r) => r.statut === "rupture").length,
    };
    return { rows, totals, counts };
  }

  // Tableau récapitulatif par ouvrage (§4) — tout est calculé automatiquement.
  fastify.get("/api/v1/stock/overview", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    return reply.send(await computeStockOverview());
  });

  // Politique de stock d'un ouvrage (§18) : lecture (avec valeurs par défaut).
  fastify.get("/api/v1/stock/policy/:isbnId", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const { isbnId } = request.params as { isbnId: string };
    const policy = await prisma.stockPolicy.findUnique({ where: { isbnId } });
    const defaultThreshold = await isbnStockAlertThreshold();
    return reply.send({
      isbn_id: isbnId,
      alert_threshold: policy?.alertThreshold ?? null,
      reorder_threshold: policy?.reorderThreshold ?? null,
      target_stock: policy?.targetStock ?? null,
      min_reprint_qty: policy?.minReprintQty ?? null,
      reprint_lead_days: policy?.reprintLeadDays ?? null,
      default_alert_threshold: defaultThreshold,
    });
  });

  const stockPolicySchema = z.object({
    alert_threshold: z.number().int().nonnegative().nullable().optional(),
    reorder_threshold: z.number().int().nonnegative().nullable().optional(),
    target_stock: z.number().int().nonnegative().nullable().optional(),
    min_reprint_qty: z.number().int().nonnegative().nullable().optional(),
    reprint_lead_days: z.number().int().nonnegative().nullable().optional(),
  });

  // Paramétrage des seuils / stock cible d'un ouvrage (§18) — réservé à la saisie.
  fastify.put("/api/v1/stock/policy/:isbnId", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { isbnId } = request.params as { isbnId: string };
    const parsed = stockPolicySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const isbn = await prisma.isbn.findUnique({ where: { id: isbnId }, select: { id: true } });
    if (!isbn) return reply.code(404).send({ code: "not_found", message: "Ouvrage (ISBN) introuvable." });
    const b = parsed.data;
    // Cohérence douce : le seuil de réappro ≤ seuil d'alerte ≤ stock cible (si tous renseignés).
    if (b.reorder_threshold != null && b.alert_threshold != null && b.reorder_threshold > b.alert_threshold) {
      return reply.code(400).send({ code: "threshold_order", message: "Le seuil de réapprovisionnement doit être inférieur ou égal au seuil d'alerte." });
    }
    if (b.target_stock != null && b.alert_threshold != null && b.target_stock < b.alert_threshold) {
      return reply.code(400).send({ code: "threshold_order", message: "Le stock cible doit être supérieur ou égal au seuil d'alerte." });
    }
    const data = {
      alertThreshold: b.alert_threshold ?? null,
      reorderThreshold: b.reorder_threshold ?? null,
      targetStock: b.target_stock ?? null,
      minReprintQty: b.min_reprint_qty ?? null,
      reprintLeadDays: b.reprint_lead_days ?? null,
      updatedBy: request.user!.id,
    };
    const saved = await prisma.stockPolicy.upsert({ where: { isbnId }, create: { isbnId, ...data }, update: data });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "stock_policy", entityId: saved.id, newValues: JSON.parse(JSON.stringify(b)), ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // --- Réapprovisionnement (§9) : cycle demande → validé → en cours →
  // (partiellement) reçu → clôturé / annulé. Le stock N'AUGMENTE QU'À LA
  // RÉCEPTION (Règle 5), via un StockMovement d'entrée. ---
  const replenishmentSchema = z.object({
    isbn_id: z.string().uuid(),
    location_id: z.string().uuid(),
    quantity_requested: z.number().int().positive(),
    supplier: z.string().max(200).optional(),
    unit_cost: z.number().nonnegative().optional(),
    order_ref: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
  });

  async function enrichReplenishments(rows: Array<Record<string, unknown> & { id: string }>) {
    const full = await prisma.replenishment.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: { isbn: { select: { isbn13: true, manuscript: { select: { title: true } } } }, location: { select: { label: true } } },
      orderBy: { requestedAt: "desc" },
    });
    const names = await resolveStockActorNames(full.flatMap((r) => [r.requestedBy, r.validatedBy, r.cancelledBy]));
    return full.map((r) => ({
      ...r,
      isbn13: r.isbn?.isbn13 ?? null,
      title: r.isbn?.manuscript?.title ?? null,
      location_label: r.location?.label ?? null,
      unit_cost: r.unitCost != null ? Number(r.unitCost) : null,
      total_cost: r.unitCost != null ? Math.round(Number(r.unitCost) * r.quantityRequested * 100) / 100 : null,
      requested_by_name: r.requestedBy ? names.get(r.requestedBy) ?? null : null,
      validated_by_name: r.validatedBy ? names.get(r.validatedBy) ?? null : null,
      cancelled_by_name: r.cancelledBy ? names.get(r.cancelledBy) ?? null : null,
      remaining: Math.max(0, r.quantityRequested - r.quantityReceived),
    }));
  }

  fastify.get("/api/v1/replenishments", { preHandler: requirePermission("stock", "consultation") }, async (_request, reply) => {
    const rows = await prisma.replenishment.findMany({ orderBy: { requestedAt: "desc" }, take: 300, select: { id: true } });
    return reply.send(await enrichReplenishments(rows));
  });

  fastify.post("/api/v1/replenishments", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = replenishmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const b = parsed.data;
    const created = await prisma.replenishment.create({
      data: { isbnId: b.isbn_id, locationId: b.location_id, quantityRequested: b.quantity_requested, supplier: b.supplier, unitCost: b.unit_cost, orderRef: b.order_ref, note: b.note, requestedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "replenishment", entityId: created.id, newValues: b, ipAddress: request.ip });
    return reply.code(201).send((await enrichReplenishments([created]))[0]);
  });

  // Validation (rôle distinct : stock:validation) — demandé → validé.
  fastify.patch("/api/v1/replenishments/:id/approve", { preHandler: requirePermission("stock", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await prisma.replenishment.findUnique({ where: { id } });
    if (!r) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    if (r.status !== "requested") return reply.code(409).send({ code: "invalid_transition", message: "Seule une demande « demandé » peut être validée." });
    const updated = await prisma.replenishment.update({ where: { id }, data: { status: "approved", validatedBy: request.user!.id, validatedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "replenishment", entityId: id, newValues: { status: "approved" }, ipAddress: request.ip });
    return reply.send((await enrichReplenishments([updated]))[0]);
  });

  // Commande passée : validé → en cours (référence de commande facultative).
  fastify.patch("/api/v1/replenishments/:id/order", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ order_ref: z.string().max(120).optional(), supplier: z.string().max(200).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
    const r = await prisma.replenishment.findUnique({ where: { id } });
    if (!r) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    if (r.status !== "approved") return reply.code(409).send({ code: "invalid_transition", message: "La commande ne peut être passée que sur une demande validée." });
    const updated = await prisma.replenishment.update({ where: { id }, data: { status: "in_progress", orderRef: parsed.data.order_ref ?? r.orderRef, supplier: parsed.data.supplier ?? r.supplier } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "replenishment", entityId: id, newValues: { status: "in_progress" }, ipAddress: request.ip });
    return reply.send((await enrichReplenishments([updated]))[0]);
  });

  // Réception (totale ou partielle) : crée l'ENTRÉE de stock correspondante.
  fastify.patch("/api/v1/replenishments/:id/receive", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ quantity: z.number().int().positive(), receipt_ref: z.string().max(120).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Quantité reçue invalide." });
    const r = await prisma.replenishment.findUnique({ where: { id } });
    if (!r) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    if (!["approved", "in_progress", "partially_received"].includes(r.status)) {
      return reply.code(409).send({ code: "invalid_transition", message: "Cette demande n'est pas en attente de réception." });
    }
    const remaining = r.quantityRequested - r.quantityReceived;
    if (parsed.data.quantity > remaining) {
      return reply.code(409).send({ code: "over_reception", message: `Réception impossible : il reste ${remaining} exemplaire(s) à recevoir sur cette demande.` });
    }
    const newReceived = r.quantityReceived + parsed.data.quantity;
    const nextStatus = newReceived >= r.quantityRequested ? "received" : "partially_received";
    const updated = await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: { type: "supplier_in", isbnId: r.isbnId, printRun: 0, toLocationId: r.locationId, quantity: parsed.data.quantity, reason: `Réception réapprovisionnement${r.orderRef ? ` (${r.orderRef})` : ""}`, beneficiary: r.supplier ?? undefined, referenceType: "replenishment", referenceId: r.id, status: "completed", condition: "vendable", movedBy: request.user!.id },
      });
      await adjustStockItem(tx, r.isbnId, r.locationId, 0, parsed.data.quantity);
      return tx.replenishment.update({ where: { id }, data: { quantityReceived: newReceived, status: nextStatus, receiptRef: parsed.data.receipt_ref ?? r.receiptRef, receivedAt: new Date() } });
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "replenishment", entityId: id, newValues: { received: parsed.data.quantity, status: nextStatus }, ipAddress: request.ip });
    return reply.send((await enrichReplenishments([updated]))[0]);
  });

  fastify.patch("/api/v1/replenishments/:id/cancel", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().max(300).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
    const r = await prisma.replenishment.findUnique({ where: { id } });
    if (!r) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    if (r.status === "received" || r.status === "cancelled") return reply.code(409).send({ code: "invalid_transition", message: "Cette demande ne peut plus être annulée." });
    const updated = await prisma.replenishment.update({ where: { id }, data: { status: "cancelled", cancelledBy: request.user!.id, cancelledAt: new Date(), cancelReason: parsed.data.reason } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "replenishment", entityId: id, newValues: { status: "cancelled" }, ipAddress: request.ip });
    return reply.send((await enrichReplenishments([updated]))[0]);
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
    // Date de la remise/retour (facultatif) : peut être antérieure au jour en
    // cours (saisie a posteriori d'une remise déjà faite). Jamais dans le futur.
    moved_at: z.coerce.date().optional(),
  });

  // Lieu de stock CANONIQUE d'un commercial (le plus ancien), créé à la 1ʳᵉ
  // remise. DÉTERMINISTE (orderBy createdAt asc) : toutes les remises visent
  // toujours le MÊME lieu, ce qui évite d'éparpiller le stock d'un commercial
  // sur plusieurs lieux (cause du « la remise ne s'intègre pas »).
  async function getOrCreateCommercialLocation(userId: string) {
    const existing = await prisma.stockLocation.findFirst({ where: { commercialUserId: userId, type: "stock_commercial" }, orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    const names = await resolveStockActorNames([userId]);
    return prisma.stockLocation.create({ data: { type: "stock_commercial", label: `Stock commercial — ${names.get(userId) ?? "commercial"}`, commercialUserId: userId } });
  }

  // TOUS les lieux de stock d'un commercial (robustesse : si un doublon
  // historique existe, on n'en perd aucun mouvement). L'état est ainsi agrégé
  // sur l'ensemble, quel que soit le lieu où une remise passée a été enregistrée.
  async function commercialLocationIds(userId: string): Promise<string[]> {
    const locs = await prisma.stockLocation.findMany({ where: { commercialUserId: userId, type: "stock_commercial" }, select: { id: true } });
    return locs.map((l) => l.id);
  }

  // Déplace des exemplaires entre un magasin et le lieu du commercial (les deux
  // côtés ajustés dans une même transaction, effet immédiat, refus si négatif).
  async function moveBetween(isbnId: string, printRun: number, quantity: number, fromId: string, toId: string, type: StockMovementType, userId: string, reason: string, ip: string, movedAt?: Date) {
    return prisma.$transaction(async (tx) => {
      const debited = await adjustStockItem(tx, isbnId, fromId, printRun, -quantity, 0, "vendable");
      if (debited.quantityPhysical < 0) throw new StockWouldGoNegativeError(fromId, debited.quantityPhysical);
      await adjustStockItem(tx, isbnId, toId, printRun, quantity, 0, "vendable");
      const mv = await tx.stockMovement.create({
        data: { type, isbnId, printRun, fromLocationId: fromId, toLocationId: toId, quantity, reason, status: "completed", condition: "vendable", movedBy: userId, ...(movedAt ? { movedAt } : {}) },
      });
      await writeAuditLog({ userId, action: "create", entityType: "stock_movement", entityId: mv.id, newValues: { type, isbnId, quantity, from: fromId, to: toId }, ipAddress: ip });
      return mv;
    });
  }

  // État du stock d'un commercial : agrégats par catégorie + détenus (à
  // justifier). Calculé sur l'ENSEMBLE de ses lieux (robustesse aux doublons) —
  // une remise datée d'un mois antérieur est comptée comme les autres (aucun
  // filtre de mois : c'est le mouvement qui fait foi).
  async function commercialStockReport(locationIds: string[]) {
    const ids = new Set(locationIds);
    if (ids.size === 0) return { recus: 0, vendus: 0, retournes: 0, offerts: 0, pertes: 0, detenus: 0, a_justifier: 0 };
    const movements = await prisma.stockMovement.findMany({ where: { OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }], status: { not: "cancelled" } } });
    let recus = 0, vendus = 0, retournes = 0, offerts = 0, pertes = 0;
    const OFFERTS: StockMovementType[] = ["author_copy", "press_copy", "promotional_out", "free_out", "event_out", "institutional_out"];
    const PERTES: StockMovementType[] = ["loss", "damage", "destruction", "pulping"];
    for (const m of movements) {
      const isIn = m.toLocationId != null && ids.has(m.toLocationId);
      const isOut = m.fromLocationId != null && ids.has(m.fromLocationId);
      // Transfert INTERNE entre deux lieux du même commercial : neutre (ni reçu ni sorti).
      if (isIn && isOut) continue;
      if (isIn) recus += m.quantity;
      else if (isOut) {
        if (m.type === "sale_out") vendus += m.quantity;
        else if (m.type === "commercial_return" || m.type === "transfer") retournes += m.quantity;
        else if (OFFERTS.includes(m.type)) offerts += m.quantity;
        else if (PERTES.includes(m.type)) pertes += m.quantity;
        else retournes += m.quantity; // toute autre sortie assimilée à une restitution
      }
    }
    const items = await prisma.stockItem.findMany({ where: { locationId: { in: locationIds } } });
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
    if (parsed.data.moved_at && parsed.data.moved_at.getTime() > Date.now()) {
      return reply.code(400).send({ code: "date_future", message: "La date de remise ne peut pas être dans le futur." });
    }
    const loc = await getOrCreateCommercialLocation(userId);
    try {
      const mv = await moveBetween(parsed.data.isbn_id, parsed.data.print_run, parsed.data.quantity, parsed.data.location_id, loc.id, "transfer", request.user!.id, parsed.data.reason || "Remise au commercial", request.ip, parsed.data.moved_at);
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

  // Ajout rapide d'un ouvrage/bien au CATALOGUE CENTRAL depuis la remise (D-042,
  // option A validée par l'opérateur). Un commercial/magasinier peut, au moment
  // de remettre des exemplaires, créer une fiche minimale (Manuscrit + ISBN) pour
  // un ouvrage encore absent du catalogue — SANS créer de catalogue parallèle :
  // c'est la même fiche ouvrage centrale que partout ailleurs. Contrôle de
  // doublon (titre normalisé ET ISBN) : si l'ouvrage existe déjà, on renvoie la
  // fiche existante pour que l'écran propose de la sélectionner plutôt que d'en
  // créer une seconde. La fiche est marquée « back-catalogue » (saisie a
  // posteriori, hors circuit de production) au statut « suivi post-publication »,
  // afin d'apparaître comme un ouvrage commercialisable ; l'éditorial peut ensuite
  // la compléter (auteur, collection, ISBN officiel…).
  const quickGoodSchema = z.object({
    title: z.string().trim().min(1, "Le titre est obligatoire."),
    isbn13: z.string().trim().optional(),
    author_name: z.string().trim().optional(),
    price: z.number().nonnegative().optional(),
  });

  // Reconstitue une entrée au format des sélecteurs d'ouvrage (`/isbns`).
  async function isbnRefFor(isbnId: string) {
    const i = await prisma.isbn.findUnique({
      where: { id: isbnId },
      include: {
        manuscript: { select: { title: true, workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { firstName: true, lastName: true } } } } } },
        priceList: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { price: true } },
      },
    });
    if (!i) return null;
    const c = i.manuscript?.workContributors?.[0]?.partner;
    const author = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null : null;
    return { id: i.id, isbn13: i.isbn13, format: i.format, status: i.status, manuscriptId: i.manuscriptId, manuscript: i.manuscript ? { title: i.manuscript.title } : null, author, price_ht: i.priceList[0] ? Number(i.priceList[0].price) : null };
  }

  fastify.post("/api/v1/commercial-stock/quick-good", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = quickGoodSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const { title, author_name, price } = parsed.data;

    // ISBN saisi : on retire tirets/espaces ; s'il est renseigné il doit compter
    // 13 chiffres (ISBN-13). Absent → une référence provisoire interne est posée.
    const rawIsbn = (parsed.data.isbn13 ?? "").replace(/[\s-]/g, "");
    if (rawIsbn && !/^\d{13}$/.test(rawIsbn)) {
      return reply.code(400).send({ code: "isbn_invalid", message: "L'ISBN doit comporter 13 chiffres (ISBN-13), ou être laissé vide." });
    }

    // Doublon par ISBN : l'ISBN n'est jamais réutilisé (contrainte d'intégrité).
    if (rawIsbn) {
      const existingIsbn = await prisma.isbn.findUnique({ where: { isbn13: rawIsbn } });
      if (existingIsbn) {
        const ref = await isbnRefFor(existingIsbn.id);
        return reply.code(409).send({ code: "isbn_exists", message: `L'ISBN ${rawIsbn} est déjà attribué à un ouvrage du catalogue.`, existing: ref });
      }
    }

    // Doublon par titre normalisé (casse/accents/ponctuation) : on propose la
    // fiche existante au lieu d'en créer une seconde.
    const dup = await findDuplicateManuscript(title);
    if (dup) {
      const dupMs = await prisma.manuscript.findFirst({
        where: { manuscriptNumber: dup.manuscriptNumber },
        select: { id: true, isbns: { where: { format: "print" }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } },
      });
      const ref = dupMs?.isbns[0] ? await isbnRefFor(dupMs.isbns[0].id) : null;
      return reply.code(409).send({ code: "duplicate_manuscript", message: duplicateMessage(dup, title), existing: ref });
    }

    const publishedStatus = await prisma.workflowStatus.findUnique({ where: { code: "SUIVI_POST_PUBLICATION" } });
    if (!publishedStatus) return reply.code(500).send({ code: "referential_missing", message: "Statut SUIVI_POST_PUBLICATION absent du référentiel (seed manquant)." });

    const manuscriptNumber = await nextManuscriptNumber();
    const isbn13Final = rawIsbn || `PROV-${manuscriptNumber}`;
    const now = new Date();

    const isbn = await prisma.$transaction(async (tx) => {
      let authorId: string | null = null;
      if (author_name) {
        const parts = author_name.split(/\s+/);
        const lastName = parts.pop() ?? author_name;
        const firstName = parts.join(" ");
        const author = await tx.partner.create({ data: { category: "auteur", firstName, lastName, createdBy: request.user!.id, updatedBy: request.user!.id } });
        authorId = author.id;
      }
      const ms = await tx.manuscript.create({
        data: {
          manuscriptNumber,
          title,
          language: "fr",
          origin: "soumission",
          statusId: publishedStatus.id,
          ownerId: request.user!.id,
          receivedAt: now,
          publicationDate: now,
          isBackCatalogue: true,
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
          ...(authorId ? { workContributors: { create: { partnerId: authorId, role: "author", displayOrder: 0 } } } : {}),
        },
      });
      const createdIsbn = await tx.isbn.create({
        data: { isbn13: isbn13Final, manuscriptId: ms.id, format: "print", status: "published", assignedAt: now, assignedBy: request.user!.id },
      });
      if (price != null && price > 0) {
        await tx.priceList.create({ data: { isbnId: createdIsbn.id, country: "CM", currency: "XAF", price, effectiveFrom: now, createdBy: request.user!.id } });
      }
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "manuscript",
        entityId: ms.id,
        newValues: { manuscriptNumber, title, quick_add_commercial: true, isbn13: isbn13Final, provisional_isbn: !rawIsbn, back_catalogue: true },
        ipAddress: request.ip,
      });
      return createdIsbn;
    });

    const ref = await isbnRefFor(isbn.id);
    return reply.code(201).send(ref);
  });

  // État de TOUS les commerciaux — responsable commercial / direction / admin stock.
  fastify.get(
    "/api/v1/commercial-stock",
    { preHandler: requireAnyPermission([{ module: "commercial", action: "validation" }, { module: "commercial", action: "administration" }, { module: "direction", action: "consultation" }, { module: "stock", action: "administration" }]) },
    async (_request, reply) => {
      const locations = await prisma.stockLocation.findMany({ where: { type: "stock_commercial", commercialUserId: { not: null } }, orderBy: { createdAt: "asc" } });
      // Regroupe par COMMERCIAL (une seule ligne par personne), en agrégeant tous
      // ses lieux — même s'il en existe plusieurs (doublon historique). Le
      // location_id affiché est le lieu canonique (le plus ancien).
      const byUser = new Map<string, string[]>();
      const canonicalLoc = new Map<string, string>();
      for (const l of locations) {
        const uid = l.commercialUserId!;
        if (!byUser.has(uid)) { byUser.set(uid, []); canonicalLoc.set(uid, l.id); }
        byUser.get(uid)!.push(l.id);
      }
      const names = await resolveStockActorNames([...byUser.keys()]);
      const rows = await Promise.all([...byUser.entries()].map(async ([uid, ids]) => ({
        user_id: uid,
        commercial_name: names.get(uid) ?? null,
        location_id: canonicalLoc.get(uid)!,
        ...(await commercialStockReport(ids)),
      })));
      rows.sort((a, b) => b.a_justifier - a.a_justifier);
      const total = rows.reduce((t, r) => ({ recus: t.recus + r.recus, vendus: t.vendus + r.vendus, retournes: t.retournes + r.retournes, offerts: t.offerts + r.offerts, pertes: t.pertes + r.pertes, detenus: t.detenus + r.detenus, a_justifier: t.a_justifier + r.a_justifier }), { recus: 0, vendus: 0, retournes: 0, offerts: 0, pertes: 0, detenus: 0, a_justifier: 0 });
      return reply.send({ reps: rows, total });
    },
  );

  // DÉTAIL des mouvements d'un commercial : la liste exacte des exemplaires
  // reçus / rendus / vendus, pour comprendre d'où vient le « Reçus » et le « À
  // justifier » (aucun stock sans mouvement, aucun mouvement sans trace). Répond
  // au besoin de vérifier « le magasin a remis X mais le commercial en affiche Y ».
  fastify.get(
    "/api/v1/commercial-stock/:userId/movements",
    { preHandler: requireAnyPermission([{ module: "commercial", action: "validation" }, { module: "commercial", action: "administration" }, { module: "direction", action: "consultation" }, { module: "stock", action: "administration" }]) },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const locIds = await commercialLocationIds(userId);
      if (locIds.length === 0) return reply.send({ location_id: null, movements: [] });
      const idSet = new Set(locIds);
      const moves = await prisma.stockMovement.findMany({
        where: { OR: [{ fromLocationId: { in: locIds } }, { toLocationId: { in: locIds } }], status: { not: "cancelled" } },
        include: { isbn: { select: { isbn13: true, manuscript: { select: { title: true } } } }, fromLocation: { select: { label: true } }, toLocation: { select: { label: true } } },
        orderBy: { movedAt: "desc" },
        take: 500,
      });
      const actorNames = await resolveStockActorNames(moves.map((m) => m.movedBy));
      const movements = moves
        // Un transfert interne entre deux lieux du même commercial n'est ni un
        // « reçu » ni un « sorti » : on ne l'affiche pas comme mouvement.
        .filter((m) => !(m.toLocationId && idSet.has(m.toLocationId) && m.fromLocationId && idSet.has(m.fromLocationId)))
        .map((m) => {
        const isIn = m.toLocationId != null && idSet.has(m.toLocationId);
        return {
          id: m.id,
          moved_at: m.movedAt,
          type: m.type,
          direction: isIn ? "in" : "out",
          quantity: m.quantity,
          title: m.isbn?.manuscript?.title ?? null,
          isbn13: m.isbn?.isbn13 ?? null,
          counterpart: isIn ? m.fromLocation?.label ?? null : m.toLocation?.label ?? null,
          reason: m.reason,
          by_name: m.movedBy ? actorNames.get(m.movedBy) ?? null : null,
        };
      });
      return reply.send({ location_id: locIds[0], movements });
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
    const locIds = await commercialLocationIds(request.user!.id);
    if (locIds.length === 0) return reply.send({ location_id: null, recus: 0, vendus: 0, retournes: 0, offerts: 0, pertes: 0, detenus: 0, a_justifier: 0 });
    return reply.send({ location_id: locIds[0], ...(await commercialStockReport(locIds)) });
  });

  // ── Réception directe du magasinier (Cas A) ────────────────────────────────
  // Entrée en stock COMPLÉMENTAIRE pour les cas non couverts par les circuits
  // automatiques (achat/don/régularisation) : les réceptions d'imprimerie passent
  // par le bon de commande et les retours clients par le module retours — on
  // n'enregistre donc PAS ici ces provenances, afin d'éviter tout double comptage.
  // Pas de blocage selon l'étape de l'ouvrage : dès qu'il a une fiche/ISBN, on
  // peut recevoir. Traçabilité : movedBy + movedAt + journal d'audit.
  const RECEPTION_PROVENANCE: Record<string, string> = {
    fournisseur: "Fournisseur (achat direct)", don: "Don reçu", regularisation: "Régularisation d'entrée", autre: "Autre provenance",
  };
  const receptionSchema = z.object({
    isbn_id: z.string().uuid(),
    location_id: z.string().uuid(),
    quantity: z.number().int().positive(),
    provenance: z.enum(["fournisseur", "don", "regularisation", "autre"]),
    received_at: z.coerce.date().optional(),
    observations: z.string().trim().max(1000).optional(),
  });
  fastify.post("/api/v1/stock/receptions", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = receptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs de réception invalides.", details: parsed.error.issues });
    const d = parsed.data;
    const [isbn, location] = await Promise.all([
      prisma.isbn.findUnique({ where: { id: d.isbn_id }, select: { id: true } }),
      prisma.stockLocation.findUnique({ where: { id: d.location_id }, select: { id: true } }),
    ]);
    if (!isbn) return reply.code(404).send({ code: "not_found", message: "Ouvrage (ISBN) introuvable." });
    if (!location) return reply.code(404).send({ code: "not_found", message: "Lieu de stockage introuvable." });
    if (d.received_at && d.received_at.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return reply.code(409).send({ code: "future_date", message: "La date de réception ne peut pas être dans le futur." });
    }
    const movement = await prisma.$transaction(async (tx) => {
      const m = await tx.stockMovement.create({
        data: {
          type: "supplier_in", isbnId: d.isbn_id, printRun: 0, toLocationId: d.location_id, quantity: d.quantity,
          reason: d.observations || null, beneficiary: RECEPTION_PROVENANCE[d.provenance], referenceType: "direct_reception",
          status: "completed", condition: "vendable", movedBy: request.user!.id, ...(d.received_at ? { movedAt: d.received_at } : {}),
        },
      });
      await adjustStockItem(tx, d.isbn_id, d.location_id, 0, d.quantity);
      return m;
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "stock_movement", entityId: movement.id, newValues: { reception: true, provenance: d.provenance, quantity: d.quantity }, ipAddress: request.ip });
    return reply.code(201).send({ id: movement.id });
  });

  // ── Cas B : ouvrage reçu ABSENT du catalogue → demande de création de fiche ─
  const ficheRequestSchema = z.object({
    title: z.string().trim().min(1).max(300),
    author_name: z.string().trim().max(200).optional(),
    isbn: z.string().trim().max(20).optional(),
    collection: z.string().trim().max(120).optional(),
    format: z.string().trim().max(60).optional(),
    provenance: z.enum(["imprimerie", "fournisseur", "don", "retour_librairie", "autre"]).optional(),
    quantity: z.number().int().min(0).default(0),
    location_id: z.string().uuid().optional(),
    observations: z.string().trim().max(1000).optional(),
  });
  fastify.post("/api/v1/stock/fiche-requests", { preHandler: requirePermission("stock", "saisie") }, async (request, reply) => {
    const parsed = ficheRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Demande invalide.", details: parsed.error.issues });
    const d = parsed.data;
    const req = await prisma.stockFicheRequest.create({
      data: { requestedBy: request.user!.id, title: d.title, authorName: d.author_name || null, isbn: d.isbn || null, collection: d.collection || null, format: d.format || null, provenance: d.provenance || null, quantity: d.quantity, locationId: d.location_id || null, observations: d.observations || null },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "stock_fiche_request", entityId: req.id, newValues: { title: d.title, quantity: d.quantity }, ipAddress: request.ip });
    for (const roleCode of ["DIR_EDITORIAL", "DIR_GENERAL"]) {
      await notifyRole({ roleCode, type: "autre", priority: "medium", title: "Ouvrage reçu absent du catalogue", body: `Le magasin a reçu « ${d.title} »${d.author_name ? ` (${d.author_name})` : ""} sans fiche dans Eclospace. Une fiche est à créer/compléter.`, entityType: "stock_fiche_request", entityId: req.id }).catch(() => {});
    }
    return reply.code(201).send({ id: req.id });
  });

  fastify.get("/api/v1/stock/fiche-requests", { preHandler: requirePermission("stock", "consultation") }, async (request, reply) => {
    const q = request.query as { status?: string };
    const where = q.status ? { status: q.status } : {};
    const rows = await prisma.stockFicheRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedBy, r.resolvedBy].filter((x): x is string => !!x)))];
    const locIds = [...new Set(rows.map((r) => r.locationId).filter((x): x is string => !!x))];
    const [users, locs] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }) : [],
      locIds.length ? prisma.stockLocation.findMany({ where: { id: { in: locIds } }, select: { id: true, label: true } }) : [],
    ]);
    const uname = (id: string | null) => (id ? users.find((u) => u.id === id)?.username ?? null : null);
    const lname = (id: string | null) => (id ? locs.find((l) => l.id === id)?.label ?? null : null);
    return reply.send({
      requests: rows.map((r) => ({
        id: r.id, status: r.status, title: r.title, author_name: r.authorName, isbn: r.isbn, collection: r.collection, format: r.format,
        provenance: r.provenance, quantity: r.quantity, location: lname(r.locationId), observations: r.observations,
        requested_by: uname(r.requestedBy), resolved_by: uname(r.resolvedBy), manuscript_id: r.manuscriptId, reject_reason: r.rejectReason,
        created_at: r.createdAt, resolved_at: r.resolvedAt,
      })),
    });
  });

  const fulfillSchema = z.object({ isbn_id: z.string().uuid(), location_id: z.string().uuid() });
  fastify.post("/api/v1/stock/fiche-requests/:id/fulfill", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = fulfillSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Indiquez l'ouvrage (ISBN) et le lieu de stockage.", details: parsed.error.issues });
    const req = await prisma.stockFicheRequest.findUnique({ where: { id } });
    if (!req) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    if (req.status !== "pending") return reply.code(409).send({ code: "not_pending", message: "Cette demande a déjà été traitée." });
    const isbn = await prisma.isbn.findUnique({ where: { id: parsed.data.isbn_id }, select: { id: true, manuscriptId: true } });
    if (!isbn) return reply.code(404).send({ code: "not_found", message: "Ouvrage (ISBN) introuvable." });
    const location = await prisma.stockLocation.findUnique({ where: { id: parsed.data.location_id }, select: { id: true } });
    if (!location) return reply.code(404).send({ code: "not_found", message: "Lieu de stockage introuvable." });

    await prisma.$transaction(async (tx) => {
      if (req.quantity > 0) {
        const m = await tx.stockMovement.create({
          data: { type: "supplier_in", isbnId: isbn.id, printRun: 0, toLocationId: parsed.data.location_id, quantity: req.quantity, reason: req.observations || null, beneficiary: req.provenance ? `Réception — ${req.provenance}` : "Réception (fiche créée)", referenceType: "fiche_request", referenceId: req.id, status: "completed", condition: "vendable", movedBy: request.user!.id },
        });
        await adjustStockItem(tx, isbn.id, parsed.data.location_id, 0, req.quantity);
        void m;
      }
      await tx.stockFicheRequest.update({ where: { id }, data: { status: "fulfilled", manuscriptId: isbn.manuscriptId, resolvedBy: request.user!.id, resolvedAt: new Date() } });
    });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "stock_fiche_request", entityId: id, newValues: { status: "fulfilled", isbnId: isbn.id, quantity: req.quantity }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  fastify.post("/api/v1/stock/fiche-requests/:id/reject", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Un motif est requis." });
    const req = await prisma.stockFicheRequest.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!req) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
    if (req.status !== "pending") return reply.code(409).send({ code: "not_pending", message: "Cette demande a déjà été traitée." });
    await prisma.stockFicheRequest.update({ where: { id }, data: { status: "rejected", rejectReason: parsed.data.reason.trim(), resolvedBy: request.user!.id, resolvedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "stock_fiche_request", entityId: id, newValues: { status: "rejected" }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });
}
