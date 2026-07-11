import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { QuoteAcceptanceMethod } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextQuoteNumber } from "../lib/quoteNumber.js";
import { createInvoiceFromEditorialQuote } from "../lib/invoicing.js";

// Compte d'auteur (décision opérateur du 10/07/2026) : DEVIS de prestation
// éditoriale → validation/signature de l'auteur (① interne, ② papier scanné,
// ③ en ligne par lien) → FACTURE générée depuis le devis accepté. Hors
// impression et communication ; aucun droit d'auteur généré.

const DEFAULT_EXCLUSIONS = "Prestation éditoriale — hors frais d'impression et de communication.";

const lineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  tax_rate: z.number().min(0).max(100).default(0),
});

const createQuoteSchema = z.object({
  partner_id: z.string().uuid(),
  manuscript_id: z.string().uuid().optional(),
  currency: z.string().min(3).max(3).default("XAF"),
  valid_until: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
  exclusions_note: z.string().max(500).optional(),
  lines: z.array(lineSchema).min(1, "Au moins une ligne de prestation."),
});

const acceptInternalSchema = z.object({
  // ① accord enregistré par un agent, ② devis papier signé et scanné.
  method: z.enum(["internal", "paper"]),
  signer_name: z.string().trim().min(2).max(200),
  note: z.string().max(1000).optional(),
  consent: z.boolean(),
});

const publicSignSchema = z.object({
  signer_name: z.string().trim().min(2).max(200),
  consent: z.boolean(),
});

// Empreinte stable des montants signés : lie l'acceptation à cette version des
// lignes et totaux (intégrité), indépendamment des champs d'audit.
function quoteTermsHash(quote: {
  quoteNumber: string;
  partnerId: string;
  currency: string;
  lines: { description: string; quantity: number; unitPrice: unknown; taxRate: unknown }[];
}): string {
  const canonical = JSON.stringify({
    quoteNumber: quote.quoteNumber,
    partnerId: quote.partnerId,
    currency: quote.currency,
    lines: quote.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: String(l.unitPrice),
      taxRate: String(l.taxRate),
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function computeTotals(lines: { quantity: number; unit_price: number; tax_rate: number }[]) {
  const totalHt = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const totalTax = lines.reduce((s, l) => s + l.quantity * l.unit_price * (l.tax_rate / 100), 0);
  return {
    totalHt: Math.round(totalHt * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    totalTtc: Math.round((totalHt + totalTax) * 100) / 100,
  };
}

const quoteInclude = {
  partner: { select: { id: true, firstName: true, lastName: true, email: true } },
  manuscript: { select: { id: true, manuscriptNumber: true, title: true } },
  lines: true,
} as const;

export default async function editorialQuoteRoutes(fastify: FastifyInstance) {
  // Création d'un devis (brouillon).
  fastify.post("/api/v1/editorial-quotes", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const parsed = createQuoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    const partner = await prisma.partner.findFirst({ where: { id: body.partner_id, deletedAt: null } });
    if (!partner) {
      return reply.code(404).send({ code: "not_found", message: "Auteur (partenaire) introuvable." });
    }
    const totals = computeTotals(body.lines);
    const quoteNumber = await nextQuoteNumber();

    const quote = await prisma.editorialQuote.create({
      data: {
        quoteNumber,
        partnerId: body.partner_id,
        manuscriptId: body.manuscript_id,
        currency: body.currency,
        validUntil: body.valid_until,
        notes: body.notes,
        exclusionsNote: body.exclusions_note ?? DEFAULT_EXCLUSIONS,
        totalHt: totals.totalHt,
        totalTax: totals.totalTax,
        totalTtc: totals.totalTtc,
        createdBy: request.user!.id,
        updatedBy: request.user!.id,
        lines: {
          create: body.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unit_price,
            taxRate: l.tax_rate,
            lineTotal: Math.round(l.quantity * l.unit_price * 100) / 100,
          })),
        },
      },
      include: quoteInclude,
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "editorial_quote",
      entityId: quote.id,
      newValues: { quoteNumber, partnerId: body.partner_id, totalTtc: totals.totalTtc },
      ipAddress: request.ip,
    });
    return reply.code(201).send(quote);
  });

  // Liste (filtrable par manuscrit / auteur / statut).
  fastify.get("/api/v1/editorial-quotes", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const q = request.query as { manuscript?: string; partner?: string; status?: string };
    const quotes = await prisma.editorialQuote.findMany({
      where: {
        deletedAt: null,
        ...(q.manuscript ? { manuscriptId: q.manuscript } : {}),
        ...(q.partner ? { partnerId: q.partner } : {}),
        ...(q.status ? { status: q.status as never } : {}),
      },
      include: quoteInclude,
      orderBy: { createdAt: "desc" },
    });
    return reply.send(quotes);
  });

  fastify.get("/api/v1/editorial-quotes/:id", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = await prisma.editorialQuote.findFirst({ where: { id, deletedAt: null }, include: quoteInclude });
    if (!quote) return reply.code(404).send({ code: "not_found", message: "Devis introuvable." });
    return reply.send(quote);
  });

  // Prépare l'envoi pour signature en ligne (③) : génère un jeton unique et
  // marque le devis « envoyé ». Le jeton alimente le lien public de signature.
  fastify.post("/api/v1/editorial-quotes/:id/send", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = await prisma.editorialQuote.findFirst({ where: { id, deletedAt: null } });
    if (!quote) return reply.code(404).send({ code: "not_found", message: "Devis introuvable." });
    if (quote.status !== "draft" && quote.status !== "sent") {
      return reply.code(409).send({ code: "invalid_status", message: "Ce devis n'est plus modifiable (déjà accepté ou facturé)." });
    }

    const token = quote.signToken ?? randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const updated = await prisma.editorialQuote.update({
      where: { id },
      data: { status: "sent", signToken: token, signTokenExpiresAt: expires, updatedBy: request.user!.id },
      include: quoteInclude,
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "editorial_quote",
      entityId: id,
      newValues: { status: "sent" },
      ipAddress: request.ip,
    });

    const base = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "";
    return reply.send({ quote: updated, sign_path: `/signer-devis/${token}`, sign_url: base ? `${base}/signer-devis/${token}` : null });
  });

  // Acceptation « interne » (① agent) ou « papier » (② scan renvoyé) — enregistrée
  // par un utilisateur habilité. La partie contractante étant l'auteur, cela
  // accepte le devis et le verrouille.
  fastify.post("/api/v1/editorial-quotes/:id/accept", { preHandler: requirePermission("finance", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = acceptInternalSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    if (!parsed.data.consent) {
      return reply.code(400).send({ code: "consent_required", message: "Confirmez l'accord de l'auteur pour valider le devis." });
    }
    const quote = await prisma.editorialQuote.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!quote) return reply.code(404).send({ code: "not_found", message: "Devis introuvable." });
    if (quote.status === "accepted" || quote.status === "invoiced") {
      return reply.code(409).send({ code: "already_accepted", message: "Ce devis est déjà accepté." });
    }
    if (quote.status === "refused" || quote.status === "expired") {
      return reply.code(409).send({ code: "invalid_status", message: "Ce devis ne peut plus être accepté." });
    }

    const termsHash = quoteTermsHash(quote);
    const updated = await prisma.editorialQuote.update({
      where: { id },
      data: {
        status: "accepted",
        acceptedAt: new Date(),
        acceptanceMethod: parsed.data.method as QuoteAcceptanceMethod,
        signerName: parsed.data.signer_name.trim(),
        acceptanceNote: parsed.data.note?.trim() || null,
        termsHash,
        acceptanceIp: request.ip,
        updatedBy: request.user!.id,
      },
      include: quoteInclude,
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "editorial_quote",
      entityId: id,
      newValues: { status: "accepted", method: parsed.data.method, signer_name: parsed.data.signer_name.trim(), terms_hash: termsHash },
      ipAddress: request.ip,
    });
    return reply.send(updated);
  });

  // Génère la facture de prestation depuis le devis accepté.
  fastify.post("/api/v1/editorial-quotes/:id/invoice", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = await prisma.editorialQuote.findFirst({ where: { id, deletedAt: null } });
    if (!quote) return reply.code(404).send({ code: "not_found", message: "Devis introuvable." });
    if (quote.status === "invoiced") {
      return reply.code(409).send({ code: "already_invoiced", message: "Une facture a déjà été émise pour ce devis." });
    }
    if (quote.status !== "accepted") {
      return reply.code(409).send({ code: "quote_not_accepted", message: "La facture n'est possible qu'après acceptation du devis par l'auteur." });
    }

    const invoice = await prisma.$transaction((tx) => createInvoiceFromEditorialQuote(tx, id));

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "invoice",
      entityId: invoice.id,
      newValues: { source: "editorial_quote", quoteId: id, invoiceNumber: invoice.invoiceNumber },
      ipAddress: request.ip,
    });
    return reply.code(201).send(invoice);
  });

  // --- Signature en ligne par l'auteur (③), sans authentification ------------
  // La sécurité repose sur le jeton (aléatoire, à usage unique, expirant). On
  // n'expose qu'un sous-ensemble du devis (pas de données internes).
  fastify.get("/api/v1/public/editorial-quotes/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const quote = await prisma.editorialQuote.findFirst({
      where: { signToken: token, deletedAt: null },
      include: { partner: { select: { firstName: true, lastName: true } }, manuscript: { select: { title: true } }, lines: true },
    });
    if (!quote) return reply.code(404).send({ code: "not_found", message: "Devis introuvable ou lien invalide." });
    if (quote.signTokenExpiresAt && quote.signTokenExpiresAt < new Date()) {
      return reply.code(410).send({ code: "link_expired", message: "Ce lien de signature a expiré. Contactez la maison d'édition." });
    }
    return reply.send({
      quote_number: quote.quoteNumber,
      status: quote.status,
      author: `${quote.partner.firstName} ${quote.partner.lastName}`,
      manuscript_title: quote.manuscript?.title ?? null,
      currency: quote.currency,
      exclusions_note: quote.exclusionsNote,
      valid_until: quote.validUntil,
      total_ht: quote.totalHt,
      total_tax: quote.totalTax,
      total_ttc: quote.totalTtc,
      accepted_at: quote.acceptedAt,
      lines: quote.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice, tax_rate: l.taxRate, line_total: l.lineTotal })),
    });
  });

  fastify.post("/api/v1/public/editorial-quotes/:token/sign", async (request, reply) => {
    const { token } = request.params as { token: string };
    const parsed = publicSignSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    if (!parsed.data.consent) {
      return reply.code(400).send({ code: "consent_required", message: "Cochez la case d'acceptation pour signer le devis." });
    }
    const quote = await prisma.editorialQuote.findFirst({ where: { signToken: token, deletedAt: null }, include: { lines: true } });
    if (!quote) return reply.code(404).send({ code: "not_found", message: "Devis introuvable ou lien invalide." });
    if (quote.signTokenExpiresAt && quote.signTokenExpiresAt < new Date()) {
      return reply.code(410).send({ code: "link_expired", message: "Ce lien de signature a expiré." });
    }
    if (quote.status === "accepted" || quote.status === "invoiced") {
      return reply.code(409).send({ code: "already_accepted", message: "Ce devis a déjà été signé." });
    }
    if (quote.status !== "sent") {
      return reply.code(409).send({ code: "invalid_status", message: "Ce devis n'est pas disponible à la signature." });
    }

    const termsHash = quoteTermsHash(quote);
    await prisma.editorialQuote.update({
      where: { id: quote.id },
      data: {
        status: "accepted",
        acceptedAt: new Date(),
        acceptanceMethod: "online_link",
        signerName: parsed.data.signer_name.trim(),
        termsHash,
        acceptanceIp: request.ip,
        // Le lien est à usage unique : consommé après signature.
        signToken: null,
        signTokenExpiresAt: null,
      },
    });

    await writeAuditLog({
      userId: null,
      action: "update",
      entityType: "editorial_quote",
      entityId: quote.id,
      newValues: { status: "accepted", method: "online_link", signer_name: parsed.data.signer_name.trim(), terms_hash: termsHash },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true, quote_number: quote.quoteNumber });
  });
}
