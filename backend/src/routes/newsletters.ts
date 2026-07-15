import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { compileNewsletter, type NewsletterItem } from "../lib/newsletters.js";
import { isMailConfigured, sendMail, senderIdentity } from "../lib/mailer.js";
import { buildNewsletterEmail, type NewsletterItemForEmail } from "../lib/documentEmail.js";

// Centre de Communication Interne — Bulletin d'actualités (« newsletter »).
// Un éditeur (communication:saisie) compose un bulletin pour une période,
// prévisualise les actualités « maison » agrégées, puis l'envoie par e-mail à
// tout le personnel. Les bulletins envoyés restent consultables dans l'ERP.
// Réutilise le compilateur (lib/newsletters), le papier à en-tête (documentEmail)
// et le mailer. N'altère aucune donnée existante.

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    intro: z.string().trim().max(4000).nullable().optional(),
    period_start: z.string().datetime(),
    period_end: z.string().datetime(),
  })
  .refine((v) => new Date(v.period_start) <= new Date(v.period_end), {
    message: "La date de début doit précéder la date de fin.",
    path: ["period_end"],
  });

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    intro: z.string().trim().max(4000).nullable().optional(),
    period_start: z.string().datetime().optional(),
    period_end: z.string().datetime().optional(),
  })
  .refine(
    (v) => !(v.period_start && v.period_end) || new Date(v.period_start) <= new Date(v.period_end),
    { message: "La date de début doit précéder la date de fin.", path: ["period_end"] },
  );

const previewQuery = z
  .object({ period_start: z.string().datetime(), period_end: z.string().datetime() })
  .refine((v) => new Date(v.period_start) <= new Date(v.period_end), {
    message: "La date de début doit précéder la date de fin.",
    path: ["period_end"],
  });

function badRequest(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: issues });
}

function itemView(it: NewsletterItem) {
  return { kind: it.kind, id: it.id, title: it.title, date: it.date, preview: it.preview };
}

// Instantané figé (JSON) → vue client. Les dates y sont des chaînes ISO.
function snapshotView(snapshot: unknown): Array<ReturnType<typeof itemView>> {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map((raw) => {
    const it = raw as Record<string, unknown>;
    return {
      kind: it.kind === "event" ? ("event" as const) : ("announcement" as const),
      id: String(it.id ?? ""),
      title: String(it.title ?? ""),
      date: it.date ? new Date(String(it.date)) : null,
      preview: it.preview == null ? null : String(it.preview),
    };
  });
}

export default async function newsletterRoutes(fastify: FastifyInstance) {
  // ── Liste des bulletins ────────────────────────────────────────────────────
  // Tout le personnel (consultation) voit les bulletins ENVOYÉS (archive).
  // Les éditeurs (saisie) voient en plus leurs brouillons.
  fastify.get("/api/v1/newsletters", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const canManage = request.user!.permissions.has("communication:saisie");
    const rows = await prisma.newsletter.findMany({
      where: { deletedAt: null, ...(canManage ? {} : { status: "envoyee" }) },
      orderBy: [{ createdAt: "desc" }],
      include: { author: { select: { id: true, username: true } } },
    });
    return reply.send(
      rows.map((n) => ({
        id: n.id,
        title: n.title,
        status: n.status,
        period_start: n.periodStart,
        period_end: n.periodEnd,
        sent_at: n.sentAt,
        recipients: n.recipients,
        author: n.author?.username ?? null,
        created_at: n.createdAt,
      })),
    );
  });

  // ── Prévisualisation d'une période (avant même de créer un brouillon) ───────
  fastify.get("/api/v1/newsletters/preview", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const parsed = previewQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const items = await compileNewsletter(new Date(parsed.data.period_start), new Date(parsed.data.period_end));
    return reply.send({ items: items.map(itemView) });
  });

  // ── Création d'un brouillon ────────────────────────────────────────────────
  fastify.post("/api/v1/newsletters", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const data = parsed.data;

    const created = await prisma.newsletter.create({
      data: {
        title: data.title,
        intro: data.intro?.trim() || null,
        periodStart: new Date(data.period_start),
        periodEnd: new Date(data.period_end),
        authorId: request.user!.id,
        createdBy: request.user!.id,
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "newsletter",
      entityId: created.id,
      newValues: { title: created.title, status: created.status },
      ipAddress: request.ip,
    });

    return reply.code(201).send({ id: created.id });
  });

  // Charge un bulletin gérable (saisie) : refuse s'il est introuvable/supprimé.
  async function loadManageable(reply: FastifyReply, id: string) {
    const nl = await prisma.newsletter.findUnique({ where: { id } });
    if (!nl || nl.deletedAt) {
      reply.code(404).send({ code: "not_found", message: "Bulletin introuvable." });
      return null;
    }
    return nl;
  }

  // ── Détail (avec actualités compilées / instantané figé) ───────────────────
  fastify.get("/api/v1/newsletters/:id", { preHandler: requirePermission("communication", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const nl = await prisma.newsletter.findUnique({
      where: { id },
      include: { author: { select: { id: true, username: true } } },
    });
    if (!nl || nl.deletedAt) return reply.code(404).send({ code: "not_found", message: "Bulletin introuvable." });

    const canManage = request.user!.permissions.has("communication:saisie");
    // Un brouillon n'est visible que des éditeurs. Les autres n'accèdent qu'aux
    // bulletins envoyés.
    if (nl.status !== "envoyee" && !canManage) {
      return reply.code(404).send({ code: "not_found", message: "Bulletin introuvable." });
    }

    // Bulletin envoyé : on montre exactement ce qui a été diffusé (instantané).
    // Brouillon : on compile en direct l'aperçu de la période.
    const items =
      nl.status === "envoyee"
        ? snapshotView(nl.itemsSnapshot)
        : (await compileNewsletter(nl.periodStart, nl.periodEnd)).map(itemView);

    return reply.send({
      id: nl.id,
      title: nl.title,
      intro: nl.intro,
      status: nl.status,
      period_start: nl.periodStart,
      period_end: nl.periodEnd,
      sent_at: nl.sentAt,
      recipients: nl.recipients,
      author: nl.author?.username ?? null,
      items,
    });
  });

  // ── Édition d'un brouillon ─────────────────────────────────────────────────
  fastify.patch("/api/v1/newsletters/:id", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const data = parsed.data;

    const nl = await loadManageable(reply, id);
    if (!nl) return;
    if (nl.status === "envoyee") {
      return reply.code(409).send({ code: "already_sent", message: "Un bulletin déjà envoyé ne peut plus être modifié." });
    }

    const nextStart = data.period_start ? new Date(data.period_start) : nl.periodStart;
    const nextEnd = data.period_end ? new Date(data.period_end) : nl.periodEnd;
    if (nextStart > nextEnd) {
      return reply.code(400).send({ code: "invalid_period", message: "La date de début doit précéder la date de fin." });
    }

    const patch: Prisma.NewsletterUpdateInput = { updatedBy: request.user!.id };
    if (data.title !== undefined) patch.title = data.title;
    if (data.intro !== undefined) patch.intro = data.intro?.trim() || null;
    if (data.period_start !== undefined) patch.periodStart = nextStart;
    if (data.period_end !== undefined) patch.periodEnd = nextEnd;

    await prisma.newsletter.update({ where: { id }, data: patch });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "newsletter",
      entityId: id,
      newValues: { fields: Object.keys(patch).filter((k) => k !== "updatedBy") },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  // ── Envoi du bulletin ──────────────────────────────────────────────────────
  // Compile les actualités de la période, fige l'instantané, puis expédie le
  // bulletin par e-mail à tout le personnel actif disposant d'une adresse.
  // Au meilleur effort : une panne d'e-mail individuel ne bloque pas l'envoi.
  fastify.post("/api/v1/newsletters/:id/send", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const nl = await loadManageable(reply, id);
    if (!nl) return;
    if (nl.status === "envoyee") {
      return reply.code(409).send({ code: "already_sent", message: "Ce bulletin a déjà été envoyé." });
    }

    const items = await compileNewsletter(nl.periodStart, nl.periodEnd);
    const emailItems: NewsletterItemForEmail[] = items.map((it) => ({
      kind: it.kind,
      title: it.title,
      date: it.date ? it.date.toISOString() : null,
      preview: it.preview,
    }));
    const snapshot = items.map((it) => ({
      kind: it.kind,
      id: it.id,
      title: it.title,
      date: it.date ? it.date.toISOString() : null,
      preview: it.preview,
    }));

    const built = buildNewsletterEmail({
      title: nl.title,
      intro: nl.intro,
      periodStart: nl.periodStart.toISOString(),
      periodEnd: nl.periodEnd.toISOString(),
      items: emailItems,
    });

    // Destinataires : tout le personnel actif disposant d'une adresse e-mail.
    const recipients = await prisma.user.findMany({
      where: { status: "active", deletedAt: null },
      select: { email: true },
    });
    const addresses = [...new Set(recipients.map((r) => r.email?.trim() ?? "").filter(Boolean))];

    const identity = senderIdentity({ username: request.user!.username, email: request.user!.email });
    let sent = 0;
    if (isMailConfigured()) {
      for (const to of addresses) {
        try {
          const ok = await sendMail({
            to,
            subject: built.subject,
            text: built.text,
            html: built.html,
            replyTo: identity.replyTo,
            fromName: identity.fromName,
          });
          if (ok) sent += 1;
        } catch (err) {
          console.error(`[newsletter] échec de l'envoi à ${to}:`, err);
        }
      }
    } else {
      // Sans SMTP (développement/test) : on journalise un envoi représentatif.
      await sendMail({ to: addresses[0] ?? "—", subject: built.subject, text: built.text, html: built.html });
    }

    const sentAt = new Date();
    await prisma.newsletter.update({
      where: { id },
      data: {
        status: "envoyee",
        sentAt,
        recipients: addresses.length,
        itemsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        updatedBy: request.user!.id,
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "status_change",
      entityType: "newsletter",
      entityId: id,
      newValues: { status: "envoyee", recipients: addresses.length, emailsSent: sent, items: items.length },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true, recipients: addresses.length, items: items.length });
  });

  // ── Suppression logique ────────────────────────────────────────────────────
  fastify.delete("/api/v1/newsletters/:id", { preHandler: requirePermission("communication", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const nl = await loadManageable(reply, id);
    if (!nl) return;
    await prisma.newsletter.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "status_change",
      entityType: "newsletter",
      entityId: id,
      newValues: { deleted: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });
}
