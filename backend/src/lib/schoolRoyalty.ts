import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getSchoolRoyaltyRate } from "./royaltySettings.js";

type Tx = Prisma.TransactionClient | PrismaClient;

const ROLE_LABELS: Record<string, string> = {
  co_author: "co-auteur",
  translator: "traducteur",
  illustrator: "illustrateur",
  preface: "préface",
};

// Renseignements obligatoires de l'ouvrage pour la conformité des droits :
// titre, ISBN, auteur principal et co-auteurs (avec leur rôle). Résolu depuis
// l'ISBN → manuscrit → contributeurs (fiches Partenaire).
export async function resolveBookInfo(
  tx: Tx,
  isbnId: string | null,
  fallbackTitle: string,
): Promise<{ manuscriptId: string | null; format: string | null; isbnCode: string | null; bookTitle: string; authorName: string | null; coAuthors: string[] }> {
  if (!isbnId) return { manuscriptId: null, format: null, isbnCode: null, bookTitle: fallbackTitle, authorName: null, coAuthors: [] };
  const isbn = await tx.isbn.findUnique({
    where: { id: isbnId },
    include: {
      manuscript: {
        include: {
          workContributors: { include: { partner: true }, orderBy: [{ role: "asc" }, { displayOrder: "asc" }] },
        },
      },
    },
  });
  if (!isbn) return { manuscriptId: null, format: null, isbnCode: null, bookTitle: fallbackTitle, authorName: null, coAuthors: [] };
  const ms = isbn.manuscript;
  const contributors = ms?.workContributors ?? [];
  const fullName = (p: { firstName: string | null; lastName: string }) => `${p.firstName ? p.firstName + " " : ""}${p.lastName}`.trim();
  const principal = contributors.find((c) => c.role === "author");
  const others = contributors.filter((c) => c !== principal);
  return {
    manuscriptId: ms?.id ?? null,
    format: isbn.format,
    isbnCode: isbn.isbn13,
    bookTitle: ms?.title ?? fallbackTitle,
    authorName: principal ? fullName(principal.partner) : null,
    coAuthors: others.map((c) => {
      const label = ROLE_LABELS[c.role];
      return label ? `${fullName(c.partner)} (${label})` : fullName(c.partner);
    }),
  };
}

interface RoyaltyTier {
  up_to: number | null;
  rate: number;
}
function rateForCumulativeQuantity(tiers: RoyaltyTier[], cumulativeQuantity: number): number {
  for (const tier of tiers) {
    if (tier.up_to === null || cumulativeQuantity <= tier.up_to) return tier.rate;
  }
  return tiers.length > 0 ? tiers[tiers.length - 1].rate : 0;
}

// Décision opérateur (31/07/2026) : pour un livre scolaire disposant d'un
// contrat d'édition actif, le CONTRAT PRIME sur le taux maison. On emprunte le
// taux du contrat (paliers évalués sur la quantité déjà écoulée du livre au
// canal scolaire), s'il en existe un ; sinon on retombe sur le taux maison.
// L'assiette reste le prix unitaire de la vente scolaire. Un taux saisi sur la
// ligne prime sur tout (géré en amont).
async function contractRateFor(tx: Tx, manuscriptId: string, format: string, moveQuantity: number): Promise<number | null> {
  const candidates = await tx.contract.findMany({
    where: { manuscriptId, status: "active", type: { in: ["edition", "coedition"] }, deletedAt: null, royaltyTerms: { isNot: null } },
    include: { royaltyTerms: true },
    orderBy: { createdAt: "desc" },
  });
  const contract = candidates.find((c) => c.formats.includes(format)) ?? candidates.find((c) => c.formats.length === 0) ?? null;
  if (!contract?.royaltyTerms) return null;
  const priorSum = await tx.schoolRoyaltyEntry.aggregate({ where: { manuscriptId }, _sum: { quantity: true } });
  const cumulativeAfter = (priorSum._sum.quantity ?? 0) + moveQuantity;
  const tiers = contract.royaltyTerms.tiers as unknown as RoyaltyTier[];
  return rateForCumulativeQuantity(tiers, cumulativeAfter);
}

interface SchoolRoyaltyLine {
  invoiceLineId?: string | null;
  isbnId: string | null;
  description: string;
  quantity: number; // signé : négatif pour un avoir / une annulation
  unitPriceHt: number;
  rate?: number | null; // taux spécifique à la ligne ; sinon taux maison
}

// Écrit une entrée de droits « livre scolaire » par ligne : instantané figé
// (ouvrage, auteur, co-auteurs, ISBN, prix unitaire, quantité, assiette, taux,
// montant). Priorité du taux appliqué (décision opérateur 31/07/2026) :
//   1. taux saisi sur la ligne (cas particulier, prime sur tout) ;
//   2. taux du CONTRAT d'édition actif du livre s'il en existe un (le contrat
//      prime sur le taux maison) — paliers respectés ;
//   3. taux maison configurable (12 % par défaut).
export async function recordSchoolRoyaltyEntries(
  tx: Tx,
  params: { invoiceId: string; sourceType: "billing_order_invoice" | "credit_note"; lines: SchoolRoyaltyLine[] },
): Promise<void> {
  if (params.lines.length === 0) return;
  const houseRate = await getSchoolRoyaltyRate();
  for (const line of params.lines) {
    const info = await resolveBookInfo(tx, line.isbnId, line.description);
    let rate: number;
    if (line.rate != null && line.rate > 0) {
      rate = line.rate; // taux de la ligne (ou contre-passation d'avoir : taux d'origine)
    } else {
      const contractRate = info.manuscriptId && info.format ? await contractRateFor(tx, info.manuscriptId, info.format, line.quantity) : null;
      rate = contractRate ?? houseRate;
    }
    const baseAmount = Math.round(line.quantity * line.unitPriceHt * 100) / 100;
    const amount = Math.round(line.quantity * line.unitPriceHt * rate * 100) / 100;
    await tx.schoolRoyaltyEntry.create({
      data: {
        invoiceId: params.invoiceId,
        invoiceLineId: line.invoiceLineId ?? undefined,
        manuscriptId: info.manuscriptId ?? undefined,
        isbnId: line.isbnId ?? undefined,
        bookTitle: info.bookTitle,
        isbnCode: info.isbnCode ?? undefined,
        authorName: info.authorName ?? undefined,
        coAuthors: info.coAuthors,
        unitPriceHt: line.unitPriceHt,
        quantity: line.quantity,
        baseAmount,
        rateApplied: rate,
        amount,
        sourceType: params.sourceType,
      },
    });
  }
}

// Relevé segmenté des droits d'auteur du livre scolaire (conformité) : regroupe
// les écritures par ouvrage (auteur, co-auteurs, ISBN, prix unitaire) sur une
// période, avec quantités, assiette et droits acquis — avoirs (quantités
// négatives) déduits. Sert l'affichage et l'export réglementaire.
export async function schoolRoyaltiesReport(params: { from?: Date; to?: Date; manuscriptId?: string }) {
  const where: Prisma.SchoolRoyaltyEntryWhereInput = {};
  if (params.from || params.to) where.computedAt = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
  if (params.manuscriptId) where.manuscriptId = params.manuscriptId;

  const entries = await prisma.schoolRoyaltyEntry.findMany({ where, orderBy: { computedAt: "desc" } });

  type Book = {
    manuscript_id: string | null;
    isbn_code: string | null;
    book_title: string;
    author_name: string | null;
    co_authors: string[];
    unit_price_ht: number;
    units: number;
    base: number;
    earned: number;
    rates: Set<number>;
  };
  const books = new Map<string, Book>();
  let totalUnits = 0;
  let totalBase = 0;
  let totalEarned = 0;

  for (const e of entries) {
    const key = e.manuscriptId ?? e.isbnCode ?? e.bookTitle;
    let b = books.get(key);
    if (!b) {
      b = {
        manuscript_id: e.manuscriptId,
        isbn_code: e.isbnCode,
        book_title: e.bookTitle,
        author_name: e.authorName,
        co_authors: e.coAuthors,
        unit_price_ht: Number(e.unitPriceHt),
        units: 0,
        base: 0,
        earned: 0,
        rates: new Set<number>(),
      };
      books.set(key, b);
    }
    b.units += e.quantity;
    b.base += Number(e.baseAmount);
    b.earned += Number(e.amount);
    b.rates.add(Number(e.rateApplied));
    totalUnits += e.quantity;
    totalBase += Number(e.baseAmount);
    totalEarned += Number(e.amount);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    total: { units: totalUnits, base: round(totalBase), earned: round(totalEarned) },
    by_book: [...books.values()]
      .map((b) => ({
        manuscript_id: b.manuscript_id,
        isbn_code: b.isbn_code,
        book_title: b.book_title,
        author_name: b.author_name,
        co_authors: b.co_authors,
        unit_price_ht: b.unit_price_ht,
        units: b.units,
        base: round(b.base),
        earned: round(b.earned),
        // Taux unique si toutes les écritures du livre partagent le même taux, sinon null.
        rate: b.rates.size === 1 ? [...b.rates][0] : null,
      }))
      .sort((a, b) => b.earned - a.earned),
  };
}
