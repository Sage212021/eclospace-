import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AnnualEventStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import { optimizeImage, UnsupportedImageError } from "../lib/imageOptimize.js";

// Planning annuel des événements (salons, festivals, réunions…).
// - Lecture : tout le personnel (babillard), en temps réel.
// - Gestion (création, modification de TOUS les champs, statut, affiche) :
//   réservée au RH et à la Direction générale — via `rh:administration`, que
//   ces deux profils possèdent. Tout est modifiable depuis l'ERP (pas de
//   coulisses). L'affiche est une image légère, affichée directement.

const READ = requirePermission("communication", "consultation");
const MANAGE = requirePermission("rh", "administration");

const eventSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional().or(z.literal("")),
  start_date: z.string().min(1), // ISO (YYYY-MM-DD ou datetime)
  end_date: z.string().optional().or(z.literal("")),
  location: z.string().trim().optional().or(z.literal("")),
  dg_present: z.boolean().default(false),
  status: z.nativeEnum(AnnualEventStatus).default("a_venir"),
});
const patchSchema = eventSchema.partial();

function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function serialize(e: {
  id: string; title: string; description: string | null; startDate: Date; endDate: Date | null;
  location: string | null; dgPresent: boolean; status: AnnualEventStatus;
  afficheMimeType: string | null; updatedAt: Date;
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    start_date: e.startDate,
    end_date: e.endDate,
    location: e.location,
    dg_present: e.dgPresent,
    status: e.status,
    has_affiche: Boolean(e.afficheMimeType),
    updated_at: e.updatedAt,
  };
}

export default async function annualEventsRoutes(fastify: FastifyInstance) {
  // Liste du planning (tri chronologique) — visible par tout le personnel.
  fastify.get("/api/v1/annual-events", { preHandler: READ }, async (_request, reply) => {
    const events = await prisma.annualEvent.findMany({
      where: { deletedAt: null },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    });
    return reply.send(events.map(serialize));
  });

  // Création d'un événement (RH / Direction générale).
  fastify.post("/api/v1/annual-events", { preHandler: MANAGE }, async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const start = toDate(parsed.data.start_date);
    if (!start) return reply.code(400).send({ code: "validation_error", message: "Date de début invalide." });
    const event = await prisma.annualEvent.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description || null,
        startDate: start,
        endDate: toDate(parsed.data.end_date),
        location: parsed.data.location || null,
        dgPresent: parsed.data.dg_present,
        status: parsed.data.status,
        createdBy: request.user!.id,
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "annual_event", entityId: event.id, newValues: { title: event.title }, ipAddress: request.ip });
    return reply.code(201).send(serialize(event));
  });

  // Modification (tous les champs sont modulables, y compris le statut).
  fastify.patch("/api/v1/annual-events/:id", { preHandler: MANAGE }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.annualEvent.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Événement introuvable." });
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const d = parsed.data;
    if (d.start_date !== undefined && !toDate(d.start_date)) return reply.code(400).send({ code: "validation_error", message: "Date de début invalide." });
    const event = await prisma.annualEvent.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.description !== undefined ? { description: d.description || null } : {}),
        ...(d.start_date !== undefined ? { startDate: toDate(d.start_date)! } : {}),
        ...(d.end_date !== undefined ? { endDate: toDate(d.end_date) } : {}),
        ...(d.location !== undefined ? { location: d.location || null } : {}),
        ...(d.dg_present !== undefined ? { dgPresent: d.dg_present } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "annual_event", entityId: id, newValues: parsed.data, ipAddress: request.ip });
    return reply.send(serialize(event));
  });

  // Suppression logique.
  fastify.delete("/api/v1/annual-events/:id", { preHandler: MANAGE }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.annualEvent.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Événement introuvable." });
    await prisma.annualEvent.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "annual_event", entityId: id, newValues: { removed: true }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // Dépôt de l'affiche (image) — optimisée en JPG léger, affichée directement.
  fastify.post("/api/v1/annual-events/:id/affiche", { preHandler: MANAGE }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.annualEvent.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Événement introuvable." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Affiche (image) requise." });
    const raw = await file.toBuffer();
    let optimized;
    try {
      optimized = await optimizeImage(raw, { maxLongSide: 1600, quality: 82, format: "jpeg" });
    } catch (err) {
      if (err instanceof UnsupportedImageError) {
        return reply.code(422).send({ code: "unsupported_image", message: "L'affiche doit être une image (JPG ou PNG)." });
      }
      throw err;
    }
    const stored = await storeFile(optimized.buffer, `affiche-${id}.${optimized.ext}`);
    const event = await prisma.annualEvent.update({
      where: { id },
      data: { afficheFilePath: stored.filePath, afficheMimeType: optimized.mime, afficheFileSize: stored.fileSize, updatedBy: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "annual_event", entityId: id, newValues: { affiche: "uploaded" }, ipAddress: request.ip });
    return reply.send(serialize(event));
  });

  // Affiche servie directement (image) — vue par tout le personnel sur le babillard.
  fastify.get("/api/v1/annual-events/:id/affiche", { preHandler: READ }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await prisma.annualEvent.findFirst({ where: { id, deletedAt: null } });
    if (!event || !event.afficheFilePath || !event.afficheMimeType) {
      return reply.code(404).send({ code: "no_affiche", message: "Aucune affiche pour cet événement." });
    }
    const buffer = await readStoredFile(event.afficheFilePath);
    reply.header("content-type", event.afficheMimeType);
    reply.header("cache-control", "private, max-age=60");
    return reply.send(buffer);
  });
}
