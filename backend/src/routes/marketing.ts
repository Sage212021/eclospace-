import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MarketingCanal, MarketingActionStatus, MarketingPriorite } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Pôle Marketing, Communication & Distribution (D-031) — Fiche marketing par
// ouvrage : positionnement (B) + plan d'action budgété (D). Rattachée à la fiche
// ouvrage centrale (aucune duplication). Lecture = marketing:consultation,
// écriture = marketing:saisie.
const READ = requirePermission("marketing", "consultation");
const WRITE = requirePermission("marketing", "saisie");

const authorInclude = {
  workContributors: { where: { role: "author" as const }, orderBy: { displayOrder: "asc" as const }, select: { partner: { select: { firstName: true, lastName: true } } } },
} as const;

function authorsOf(w: { workContributors: { partner: { firstName: string; lastName: string } }[] }): string[] {
  return w.workContributors.map((c) => `${c.partner.firstName} ${c.partner.lastName}`.trim()).filter(Boolean);
}

const planSchema = z.object({
  public_cible: z.string().optional(),
  public_secondaire: z.string().optional(),
  zone_geo: z.string().optional(),
  besoin: z.string().optional(),
  argumentaire: z.string().optional(),
  arguments_vente: z.string().optional(),
  positionnement: z.string().optional(),
  responsable_id: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
});

const actionSchema = z.object({
  canal: z.nativeEnum(MarketingCanal),
  action: z.string().trim().min(1),
  responsable: z.string().optional(),
  date_debut: z.string().nullable().optional(),
  echeance: z.string().nullable().optional(),
  budget_prevu: z.number().nonnegative().nullable().optional(),
  budget_engage: z.number().nonnegative().nullable().optional(),
  statut: z.nativeEnum(MarketingActionStatus).optional(),
  priorite: z.nativeEnum(MarketingPriorite).optional(),
  lien: z.string().optional(),
  resultat: z.string().optional(),
  commentaire: z.string().optional(),
});
const actionPatchSchema = actionSchema.partial();

function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const num = (v: unknown) => (v == null ? null : Number(v));

function actionView(a: {
  id: string; canal: MarketingCanal; action: string; responsable: string | null; dateDebut: Date | null; echeance: Date | null;
  budgetPrevu: unknown; budgetEngage: unknown; statut: MarketingActionStatus; priorite: MarketingPriorite; lien: string | null; resultat: string | null; commentaire: string | null;
}) {
  return {
    id: a.id, canal: a.canal, action: a.action, responsable: a.responsable,
    date_debut: a.dateDebut, echeance: a.echeance,
    budget_prevu: num(a.budgetPrevu), budget_engage: num(a.budgetEngage),
    statut: a.statut, priorite: a.priorite, lien: a.lien, resultat: a.resultat, commentaire: a.commentaire,
  };
}

export default async function marketingRoutes(fastify: FastifyInstance) {
  // Liste des fiches marketing (une par ouvrage) avec synthèse budget/actions.
  fastify.get("/api/v1/marketing/plans", { preHandler: READ }, async (_request, reply) => {
    const plans = await prisma.marketingPlan.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        manuscript: { select: { id: true, manuscriptNumber: true, title: true, ...authorInclude } },
        actions: { where: { deletedAt: null }, select: { statut: true, budgetPrevu: true, budgetEngage: true } },
      },
    });
    const respIds = plans.map((p) => p.responsableId).filter((x): x is string => Boolean(x));
    const users = respIds.length ? await prisma.user.findMany({ where: { id: { in: respIds } }, select: { id: true, username: true } }) : [];
    const nameById = new Map(users.map((u) => [u.id, u.username]));

    const items = plans.map((p) => {
      const active = p.actions.filter((a) => a.statut !== "annule");
      return {
        id: p.id,
        manuscript: { id: p.manuscript.id, reference: p.manuscript.manuscriptNumber, title: p.manuscript.title, authors: authorsOf(p.manuscript) },
        responsable: p.responsableId ? { id: p.responsableId, name: nameById.get(p.responsableId) ?? "—" } : null,
        actions_total: active.length,
        actions_done: active.filter((a) => a.statut === "fait").length,
        budget_prevu: active.reduce((s, a) => s + Number(a.budgetPrevu ?? 0), 0),
        budget_engage: active.reduce((s, a) => s + Number(a.budgetEngage ?? 0), 0),
        updated_at: p.updatedAt,
      };
    });
    return reply.send({ items });
  });

  // Recherche d'ouvrages auxquels attacher (ou dont ouvrir) une fiche marketing.
  fastify.get("/api/v1/marketing/manuscripts", { preHandler: READ }, async (request, reply) => {
    const q = String((request.query as Record<string, string | undefined>).q ?? "").trim();
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { manuscriptNumber: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: { receivedAt: "desc" },
      take: 25,
      select: { id: true, manuscriptNumber: true, title: true, ...authorInclude, marketingPlan: { select: { id: true, deletedAt: true } } },
    });
    return reply.send({
      items: rows.map((m) => ({ id: m.id, reference: m.manuscriptNumber, title: m.title, authors: authorsOf(m), has_plan: Boolean(m.marketingPlan && !m.marketingPlan.deletedAt) })),
    });
  });

  // Fiche marketing d'un ouvrage (positionnement + actions) — null si absente.
  fastify.get("/api/v1/marketing/manuscripts/:id/plan", { preHandler: READ }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, manuscriptNumber: true, title: true, subtitle: true, publicationDate: true, ...authorInclude, collection: { select: { label: true } }, genre: { select: { label: true } }, workMetadata: { select: { pricePublic: true } } },
    });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });
    const plan = await prisma.marketingPlan.findFirst({
      where: { manuscriptId: id, deletedAt: null },
      include: { actions: { where: { deletedAt: null }, orderBy: [{ echeance: "asc" }, { createdAt: "asc" }] } },
    });
    const identity = {
      id: manuscript.id, reference: manuscript.manuscriptNumber, title: manuscript.title, subtitle: manuscript.subtitle,
      authors: authorsOf(manuscript), collection: manuscript.collection?.label ?? null, genre: manuscript.genre?.label ?? null,
      publication_date: manuscript.publicationDate, price_public: num(manuscript.workMetadata?.pricePublic),
    };
    if (!plan) return reply.send({ manuscript: identity, plan: null });
    return reply.send({
      manuscript: identity,
      plan: {
        id: plan.id,
        public_cible: plan.publicCible, public_secondaire: plan.publicSecondaire, zone_geo: plan.zoneGeo,
        besoin: plan.besoin, argumentaire: plan.argumentaire, arguments_vente: plan.argumentsVente, positionnement: plan.positionnement,
        responsable_id: plan.responsableId, notes: plan.notes,
        actions: plan.actions.map(actionView),
      },
    });
  });

  // Crée ou met à jour la fiche (positionnement) d'un ouvrage.
  fastify.put("/api/v1/marketing/manuscripts/:id/plan", { preHandler: WRITE }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = planSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Ouvrage introuvable." });
    const d = parsed.data;
    const data = {
      publicCible: d.public_cible ?? null, publicSecondaire: d.public_secondaire ?? null, zoneGeo: d.zone_geo ?? null,
      besoin: d.besoin ?? null, argumentaire: d.argumentaire ?? null, argumentsVente: d.arguments_vente ?? null,
      positionnement: d.positionnement ?? null, responsableId: d.responsable_id ?? null, notes: d.notes ?? null,
    };
    const plan = await prisma.marketingPlan.upsert({
      where: { manuscriptId: id },
      update: { ...data, updatedBy: request.user!.id, deletedAt: null },
      create: { manuscriptId: id, ...data, createdBy: request.user!.id, updatedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "marketing_plan", entityId: plan.id, newValues: { manuscript: id }, ipAddress: request.ip });
    return reply.send({ id: plan.id });
  });

  // Ajoute une action au plan.
  fastify.post("/api/v1/marketing/plans/:planId/actions", { preHandler: WRITE }, async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const parsed = actionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Action invalide (canal et libellé requis)." });
    const plan = await prisma.marketingPlan.findFirst({ where: { id: planId, deletedAt: null }, select: { id: true } });
    if (!plan) return reply.code(404).send({ code: "not_found", message: "Fiche marketing introuvable." });
    const d = parsed.data;
    const created = await prisma.marketingAction.create({
      data: {
        planId, canal: d.canal, action: d.action, responsable: d.responsable || null,
        dateDebut: toDate(d.date_debut), echeance: toDate(d.echeance),
        budgetPrevu: d.budget_prevu ?? null, budgetEngage: d.budget_engage ?? null,
        statut: d.statut ?? "a_faire", priorite: d.priorite ?? "normale",
        lien: d.lien || null, resultat: d.resultat || null, commentaire: d.commentaire || null,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "marketing_action", entityId: created.id, newValues: { plan: planId, action: d.action }, ipAddress: request.ip });
    return reply.code(201).send(actionView(created));
  });

  // Modifie une action.
  fastify.patch("/api/v1/marketing/actions/:id", { preHandler: WRITE }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = actionPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Action invalide." });
    const existing = await prisma.marketingAction.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Action introuvable." });
    const d = parsed.data;
    const updated = await prisma.marketingAction.update({
      where: { id },
      data: {
        ...(d.canal !== undefined ? { canal: d.canal } : {}),
        ...(d.action !== undefined ? { action: d.action } : {}),
        ...(d.responsable !== undefined ? { responsable: d.responsable || null } : {}),
        ...(d.date_debut !== undefined ? { dateDebut: toDate(d.date_debut) } : {}),
        ...(d.echeance !== undefined ? { echeance: toDate(d.echeance) } : {}),
        ...(d.budget_prevu !== undefined ? { budgetPrevu: d.budget_prevu ?? null } : {}),
        ...(d.budget_engage !== undefined ? { budgetEngage: d.budget_engage ?? null } : {}),
        ...(d.statut !== undefined ? { statut: d.statut } : {}),
        ...(d.priorite !== undefined ? { priorite: d.priorite } : {}),
        ...(d.lien !== undefined ? { lien: d.lien || null } : {}),
        ...(d.resultat !== undefined ? { resultat: d.resultat || null } : {}),
        ...(d.commentaire !== undefined ? { commentaire: d.commentaire || null } : {}),
      },
    });
    return reply.send(actionView(updated));
  });

  // Retire une action (suppression logique).
  fastify.delete("/api/v1/marketing/actions/:id", { preHandler: WRITE }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.marketingAction.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Action introuvable." });
    await prisma.marketingAction.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "marketing_action", entityId: id, newValues: { deleted: true }, ipAddress: request.ip });
    return reply.send({ deleted: true });
  });
}
