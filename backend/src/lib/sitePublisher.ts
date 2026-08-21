import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { readStoredFile } from "./storage.js";
import { optimizeImage, getOrCreateThumbnail, UnsupportedImageError } from "./imageOptimize.js";

// Publication d'un ouvrage sur le site vitrine (site sur-mesure PHP + React,
// sans API dédiée). Le site ne pouvant pas recevoir automatiquement les fiches,
// l'ERP prépare une **fiche prête à publier** — tous les champs propres et
// rangés — que le maquettiste copie/colle dans le site, comme il ajoute déjà
// les ouvrages. L'ERP garde la trace de ce qui est publié (état + lien).
//
// Le socle reste prêt pour une publication automatique ultérieure (si le site
// expose un jour une entrée API), mais aucune dépendance n'est requise ici.

export interface SiteFichePayload {
  title: string;
  subtitle: string | null;
  author: string | null;
  genre: string | null;
  price: number | null; // XAF
  currency: string;
  summary: string | null;
  isbn: string | null;
}

// Extrait un prix (XAF) du champ priceByCountry, souple sur le format.
function resolvePrice(priceByCountry: unknown): number | null {
  if (priceByCountry == null || typeof priceByCountry !== "object") return null;
  const rec = priceByCountry as Record<string, unknown>;
  const pick = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v && typeof v === "object") {
      const amt = (v as Record<string, unknown>).amount ?? (v as Record<string, unknown>).value;
      if (typeof amt === "number" && Number.isFinite(amt)) return amt;
    }
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  for (const key of ["CM", "XAF", "cm", "xaf"]) {
    if (key in rec) {
      const p = pick(rec[key]);
      if (p != null) return p;
    }
  }
  for (const v of Object.values(rec)) {
    const p = pick(v);
    if (p != null) return p;
  }
  return null;
}

// Rassemble les données de l'ouvrage pour sa fiche « site ».
export async function buildFichePayload(manuscriptId: string): Promise<SiteFichePayload> {
  const m = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    include: {
      genre: true,
      workMetadata: true,
      workContributors: { where: { role: "author" }, include: { partner: true }, orderBy: { displayOrder: "asc" } },
      isbns: true,
    },
  });
  if (!m || m.deletedAt) throw new Error("Ouvrage introuvable.");

  const partner = m.workContributors[0]?.partner;
  const author = partner ? partner.penName || `${partner.firstName} ${partner.lastName}`.trim() : null;
  const printIsbn = m.isbns.find((i) => i.format === "print") ?? m.isbns[0];

  return {
    title: m.title,
    subtitle: m.subtitle ?? null,
    author,
    genre: m.genre?.label ?? null,
    price: resolvePrice(m.workMetadata?.priceByCountry ?? null),
    currency: "XAF",
    summary: m.summary || m.workMetadata?.summary || null,
    isbn: printIsbn?.isbn13 ?? null,
  };
}

// Fiche texte prête à copier/coller sur le site.
export function formatFiche(p: SiteFichePayload): string {
  const price = p.price != null ? `${p.price.toLocaleString("fr-FR")} ${p.currency}` : "—";
  const lines = [
    `Titre : ${[p.title, p.subtitle].filter(Boolean).join(" — ")}`,
    `Auteur : ${p.author ?? "—"}`,
    `Genre : ${p.genre ?? "—"}`,
    `Prix : ${price}`,
    `ISBN : ${p.isbn ?? "—"}`,
    "",
    "Résumé :",
    p.summary ?? "—",
  ];
  return lines.join("\n");
}

// Couverture (1re) de l'ouvrage, si elle a été déposée : renvoie la version de
// document téléchargeable, pour que la fiche « site » embarque aussi l'image.
async function coverFor(manuscriptId: string) {
  const asset = await prisma.imageAsset.findFirst({
    where: { manuscriptId, type: "couverture_1", documentVersionId: { not: null }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { documentVersion: { select: { id: true, mimeType: true } } },
  });
  const v = asset?.documentVersion;
  return {
    available: Boolean(v),
    version_id: v?.id ?? null,
    mime_type: v?.mimeType ?? null,
    is_image: Boolean(v?.mimeType?.startsWith("image/")),
  };
}

// Nom de fichier propre (sans accents ni espaces) pour la couverture téléchargée.
function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // enlève les accents
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "couverture"
  );
}

// Format d'affichage des couvertures sur le site vitrine (eclosion.cm) :
// vignettes **portrait** (≈ 2:3). On cale donc la couverture pour qu'elle tienne
// dans une boîte 1080 × 1600 — proportions conservées, **couverture entière**
// (aucune coupe : ni titre ni auteur perdus ; le site recadre lui-même si besoin).
const SITE_COVER_BOX = { maxWidth: 1080, maxHeight: 1600 } as const;

// Couverture « prête pour le web » : lit la couverture déposée (souvent lourde,
// en qualité impression) et renvoie une image légère, en JPG de très bonne
// qualité, au format portrait du site, prête à joindre à la fiche. Réduction
// seule (jamais d'agrandissement), couverture entière (aucune coupe).
export async function optimizedCoverForSite(manuscriptId: string): Promise<{
  buffer: Buffer;
  mime: string;
  filename: string;
} | null> {
  const asset = await prisma.imageAsset.findFirst({
    where: { manuscriptId, type: "couverture_1", documentVersionId: { not: null }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { documentVersion: { select: { id: true, filePath: true, mimeType: true } } },
  });
  const v = asset?.documentVersion;
  if (!v || !v.mimeType?.startsWith("image/")) return null;

  const original = await readStoredFile(v.filePath);
  const optimized = await optimizeImage(original, { ...SITE_COVER_BOX, quality: 86, format: "jpeg" });

  const payload = await buildFichePayload(manuscriptId);
  const base = slugify(payload.title || "couverture");
  const filename = `couverture-${base}.${optimized.ext}`;
  return { buffer: optimized.buffer, mime: optimized.mime, filename };
}

// Miniature (aperçu léger) de la couverture — mise en cache au 1er accès. Évite
// de ré-optimiser la couverture pleine taille (≈1600 px) à chaque affichage
// d'un petit aperçu (listes, fiches).
export async function siteCoverThumbnail(manuscriptId: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const asset = await prisma.imageAsset.findFirst({
    where: { manuscriptId, type: "couverture_1", documentVersionId: { not: null }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { documentVersion: { select: { filePath: true, mimeType: true } } },
  });
  const v = asset?.documentVersion;
  if (!v || !v.mimeType?.startsWith("image/")) return null;
  return getOrCreateThumbnail(v.filePath);
}

export { UnsupportedImageError };

// Aperçu : la fiche prête à publier + la couverture + l'état + champs manquants.
export async function previewSiteFiche(manuscriptId: string) {
  const payload = await buildFichePayload(manuscriptId);
  const [existing, cover] = await Promise.all([
    prisma.sitePublication.findUnique({ where: { manuscriptId } }),
    coverFor(manuscriptId),
  ]);
  const missing: string[] = [];
  if (!payload.author) missing.push("auteur");
  if (!payload.genre) missing.push("genre");
  if (payload.price == null) missing.push("prix");
  if (!payload.summary) missing.push("résumé");
  return {
    payload,
    fiche: formatFiche(payload),
    cover,
    missing,
    status: existing?.status ?? "non_publie",
    external_url: existing?.externalUrl ?? null,
    published_at: existing?.publishedAt ?? null,
  };
}

// Marque (ou retire) la publication manuelle sur le site, avec le lien éventuel
// de la fiche en ligne. L'ERP garde ainsi la trace de ce qui est sur le site.
export async function setSitePublished(
  manuscriptId: string,
  actor: { id: string; ip?: string | null },
  published: boolean,
  url?: string | null,
) {
  const payload = await buildFichePayload(manuscriptId); // valide l'existence de l'ouvrage
  const payloadJson = JSON.parse(JSON.stringify(payload));

  const row = await prisma.sitePublication.upsert({
    where: { manuscriptId },
    create: {
      manuscriptId,
      status: published ? "publie" : "non_publie",
      externalUrl: url?.trim() || null,
      lastPayload: payloadJson,
      ...(published ? { publishedAt: new Date(), publishedBy: actor.id } : {}),
    },
    update: {
      status: published ? "publie" : "non_publie",
      externalUrl: url?.trim() || null,
      lastPayload: payloadJson,
      publishedAt: published ? new Date() : null,
      publishedBy: published ? actor.id : null,
    },
  });

  await writeAuditLog({
    userId: actor.id,
    action: "update",
    entityType: "site_publication",
    entityId: manuscriptId,
    newValues: { published, url: url?.trim() || null },
    ipAddress: actor.ip ?? null,
  });

  return { status: row.status, external_url: row.externalUrl, published_at: row.publishedAt };
}
