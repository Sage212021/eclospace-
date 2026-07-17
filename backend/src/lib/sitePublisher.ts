import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";

// Publication d'un ouvrage sur le site vitrine (boutique WordPress/WooCommerce).
// L'ERP reste la source : le maquettiste « publie » un ouvrage, l'ERP envoie le
// produit (nom, auteur, genre, prix, résumé, ISBN, couverture) au site et garde
// le lien + l'état. Le branchement réel s'active par variables d'environnement
// (renseignées sur l'hébergement, jamais dans le dépôt) ; sans configuration,
// l'action produit un APERÇU (ce qui serait envoyé) sans rien publier.
//
//   SITE_WC_URL          adresse du site (ex. https://www.eclosion.cm)
//   SITE_WC_KEY          clé (consumer key) de l'API WooCommerce
//   SITE_WC_SECRET       secret (consumer secret) de l'API WooCommerce

export interface SiteProductPayload {
  name: string;
  author: string | null;
  category: string | null; // = genre
  price: number | null; // XAF
  currency: string;
  description: string | null;
  sku: string | null; // ISBN
  cover: { available: boolean; version_id: string | null };
}

export function siteConfig(): { configured: boolean; url: string | null; key?: string; secret?: string } {
  const url = process.env.SITE_WC_URL?.replace(/\/$/, "") || null;
  const key = process.env.SITE_WC_KEY || "";
  const secret = process.env.SITE_WC_SECRET || "";
  return { configured: Boolean(url && key && secret), url, key, secret };
}

// Extrait un prix (XAF) du champ priceByCountry, souple sur le format :
// { "CM": 3000 } / { "XAF": 3000 } / { "CM": { "amount": 3000 } } / premier nombre.
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

// Construit le produit à envoyer au site à partir d'un ouvrage de l'ERP.
export async function buildProductPayload(manuscriptId: string): Promise<SiteProductPayload> {
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
  const summary = m.summary || m.workMetadata?.summary || null;

  return {
    name: [m.title, m.subtitle].filter(Boolean).join(" — "),
    author,
    category: m.genre?.label ?? null,
    price: resolvePrice(m.workMetadata?.priceByCountry ?? null),
    currency: "XAF",
    description: summary,
    sku: printIsbn?.isbn13 ?? null,
    // Le transfert effectif de l'image (URL publique / import média) est réglé
    // au branchement : ici on signale seulement sa disponibilité.
    cover: { available: false, version_id: null },
  };
}

// Aperçu (sans rien publier) : ce qui serait envoyé au site pour cet ouvrage.
export async function previewSitePublication(manuscriptId: string) {
  const payload = await buildProductPayload(manuscriptId);
  const config = siteConfig();
  const existing = await prisma.sitePublication.findUnique({ where: { manuscriptId } });
  const missing: string[] = [];
  if (!payload.author) missing.push("auteur");
  if (!payload.category) missing.push("genre");
  if (payload.price == null) missing.push("prix");
  if (!payload.description) missing.push("résumé");
  return {
    configured: config.configured,
    site_url: config.url,
    payload,
    missing,
    status: existing?.status ?? "non_publie",
    external_url: existing?.externalUrl ?? null,
    published_at: existing?.publishedAt ?? null,
  };
}

// Appel WooCommerce (création/mise à jour d'un produit). Résout la catégorie
// par son nom (création si absente). N'est exécuté qu'une fois le site
// configuré (déploiement) — non testé depuis l'environnement de développement.
async function upsertWooProduct(
  config: { url: string; key: string; secret: string },
  payload: SiteProductPayload,
  externalId: string | null,
): Promise<{ id: string; url: string }> {
  const auth = "Basic " + Buffer.from(`${config.key}:${config.secret}`).toString("base64");
  const headers = { Authorization: auth, "Content-Type": "application/json" };

  // Catégorie (= genre) : recherche par nom, création si nécessaire.
  let categoryId: number | null = null;
  if (payload.category) {
    const q = await fetch(`${config.url}/wp-json/wc/v3/products/categories?search=${encodeURIComponent(payload.category)}`, { headers });
    const found = (await q.json()) as Array<{ id: number; name: string }>;
    const match = Array.isArray(found) ? found.find((c) => c.name.toLowerCase() === payload.category!.toLowerCase()) : null;
    if (match) categoryId = match.id;
    else {
      const created = await fetch(`${config.url}/wp-json/wc/v3/products/categories`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: payload.category }),
      });
      categoryId = ((await created.json()) as { id: number }).id;
    }
  }

  const body = {
    name: payload.name,
    type: "simple",
    status: "publish",
    ...(payload.price != null ? { regular_price: String(payload.price) } : {}),
    description: payload.description ?? "",
    ...(payload.sku ? { sku: payload.sku } : {}),
    ...(categoryId ? { categories: [{ id: categoryId }] } : {}),
    ...(payload.author ? { meta_data: [{ key: "auteur", value: payload.author }] } : {}),
  };

  const endpoint = externalId ? `${config.url}/wp-json/wc/v3/products/${externalId}` : `${config.url}/wp-json/wc/v3/products`;
  const res = await fetch(endpoint, { method: externalId ? "PUT" : "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WooCommerce ${res.status} : ${text.slice(0, 200)}`);
  }
  const product = (await res.json()) as { id: number; permalink?: string };
  return { id: String(product.id), url: product.permalink ?? `${config.url}/?p=${product.id}` };
}

type PublishResult =
  | { published: false; reason: "not_configured"; payload: SiteProductPayload }
  | { published: true; external_url: string; external_id: string };

// Publie (ou met à jour) un ouvrage sur le site. Sans configuration : enregistre
// l'aperçu et renvoie « not_configured » (aucun envoi). Configuré : crée/actualise
// le produit et mémorise le lien.
export async function publishToSite(manuscriptId: string, actor: { id: string; ip?: string | null }): Promise<PublishResult> {
  const payload = await buildProductPayload(manuscriptId);
  const config = siteConfig();
  const existing = await prisma.sitePublication.findUnique({ where: { manuscriptId } });
  const payloadJson = JSON.parse(JSON.stringify(payload));

  if (!config.configured) {
    await prisma.sitePublication.upsert({
      where: { manuscriptId },
      create: { manuscriptId, lastPayload: payloadJson },
      update: { lastPayload: payloadJson },
    });
    return { published: false, reason: "not_configured", payload };
  }

  try {
    const product = await upsertWooProduct(
      { url: config.url!, key: config.key!, secret: config.secret! },
      payload,
      existing?.externalId ?? null,
    );
    await prisma.sitePublication.upsert({
      where: { manuscriptId },
      create: {
        manuscriptId,
        status: "publie",
        externalId: product.id,
        externalUrl: product.url,
        lastPayload: payloadJson,
        publishedAt: new Date(),
        publishedBy: actor.id,
      },
      update: {
        status: "publie",
        externalId: product.id,
        externalUrl: product.url,
        lastPayload: payloadJson,
        lastError: null,
        publishedAt: new Date(),
        publishedBy: actor.id,
      },
    });
    await writeAuditLog({
      userId: actor.id,
      action: "update",
      entityType: "site_publication",
      entityId: manuscriptId,
      newValues: { published: true, external_id: product.id },
      ipAddress: actor.ip ?? null,
    });
    return { published: true, external_url: product.url, external_id: product.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec de la publication.";
    await prisma.sitePublication.upsert({
      where: { manuscriptId },
      create: { manuscriptId, status: "erreur", lastPayload: payloadJson, lastError: message },
      update: { status: "erreur", lastPayload: payloadJson, lastError: message },
    });
    throw new Error(message);
  }
}
