import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Corps multipart minimal pour téléverser un fichier via app.inject.
function multipartFile(filename: string, contentType: string, content: Buffer) {
  const boundary = "----ecl" + Math.random().toString(36).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

// Bon de livraison (Ch. 17 §17.8, demande opérateur) : registre des livraisons,
// commandes livrables (reliquats) et détail imprimable du bon de livraison —
// coordonnées client, quantité commandée vs livrée, mention complète/partielle.
describe("Bon de livraison — registre, reliquats et détail imprimable", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;
  let customerId: string;
  let isbnId: string;
  let orderId: string;
  let firstDeliveryId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;

    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: "Entrepôt BL" } })).json().id;

    // Ouvrage au catalogue avec du stock.
    const manuscript = (await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title: "Ouvrage Bon de Livraison", genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: "BL" } },
    })).json();
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contract = (await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} } })).json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie }, payload: { status } });
    }
    const pool = (await app.inject({ method: "POST", url: "/api/v1/isbn-pools", headers: { cookie }, payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 } })).json();
    isbnId = (await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/isbn`, headers: { cookie }, payload: { format: "print", pool_id: pool.id } })).json().id;
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 50, reason: "Réception" } });

    // Client avec coordonnées (pour l'en-tête du bon de livraison).
    customerId = (await app.inject({
      method: "POST", url: "/api/v1/customers", headers: { cookie },
      payload: { category: "librairie", name: "Librairie du Centre", contact_name: "Mme Awono", phone: "+237 6 99 00 11 22", address: "12 rue des Éditeurs, Yaoundé" },
    })).json().id;

    // Commande confirmée de 10 exemplaires.
    orderId = (await app.inject({
      method: "POST", url: "/api/v1/sales-orders", headers: { cookie },
      payload: { customer_id: customerId, channel: "comptoir", location_id: warehouseId, lines: [{ isbn_id: isbnId, quantity: 10, unit_price: 10000 }] },
    })).json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("expose la commande comme livrable avec le reliquat à livrer", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/deliveries/eligible-orders", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const orders = res.json() as Array<{ id: string; lines: { isbn_id: string; ordered: number; delivered: number; remaining: number }[] }>;
    const row = orders.find((o) => o.id === orderId)!;
    expect(row).toBeTruthy();
    const line = row.lines.find((l) => l.isbn_id === isbnId)!;
    expect(line.ordered).toBe(10);
    expect(line.delivered).toBe(0);
    expect(line.remaining).toBe(10);
  });

  it("livraison PARTIELLE : le bon de livraison détaille qté commandée vs livrée et porte la mention « partielle »", async () => {
    const del = await app.inject({ method: "POST", url: `/api/v1/sales-orders/${orderId}/deliveries`, headers: { cookie }, payload: { carrier: "Coursier interne", lines: [{ isbn_id: isbnId, quantity: 4 }] } });
    expect(del.statusCode).toBe(201);
    const deliveryId = del.json().id as string;
    firstDeliveryId = deliveryId;

    const note = (await app.inject({ method: "GET", url: `/api/v1/deliveries/${deliveryId}/note`, headers: { cookie } })).json() as {
      delivery_number: string; order_number: string; invoice_number: string | null; complete: boolean;
      customer: { name: string; contact_name: string | null; phone: string | null; address: string | null };
      lines: { isbn13: string; title: string; ordered: number; delivered: number }[];
    };
    expect(note.delivery_number).toMatch(/^BL-/);
    expect(note.order_number).toBeTruthy();
    // La livraison ferme génère la facture (Ch. 18 §18.2) : sa référence figure sur le bon.
    expect(note.invoice_number).toBeTruthy();
    expect(note.complete).toBe(false); // 4 sur 10 → partielle
    // Coordonnées client reprises pour l'en-tête / l'adresse de livraison.
    expect(note.customer.name).toBe("Librairie du Centre");
    expect(note.customer.phone).toBe("+237 6 99 00 11 22");
    expect(note.customer.address).toContain("Yaoundé");
    // Ligne : quantité commandée (10) vs livrée (4) + titre résolu.
    const line = note.lines.find((l) => l.delivered === 4)!;
    expect(line.ordered).toBe(10);
    expect(line.title).toBe("Ouvrage Bon de Livraison");

    // Le registre liste la livraison, marquée partielle.
    const list = (await app.inject({ method: "GET", url: "/api/v1/deliveries", headers: { cookie } })).json() as Array<{ id: string; complete: boolean; total_quantity: number }>;
    const rowd = list.find((d) => d.id === deliveryId)!;
    expect(rowd.complete).toBe(false);
    expect(rowd.total_quantity).toBe(4);
  });

  it("livraison du reliquat : la commande devient « complète » et sort des commandes livrables", async () => {
    const del2 = await app.inject({ method: "POST", url: `/api/v1/sales-orders/${orderId}/deliveries`, headers: { cookie }, payload: { lines: [{ isbn_id: isbnId, quantity: 6 }] } });
    expect(del2.statusCode).toBe(201);
    const del2Id = del2.json().id as string;

    const note = (await app.inject({ method: "GET", url: `/api/v1/deliveries/${del2Id}/note`, headers: { cookie } })).json() as { complete: boolean };
    expect(note.complete).toBe(true); // 4 + 6 = 10 → complète

    // La commande n'apparaît plus comme livrable (plus de reliquat).
    const orders = (await app.inject({ method: "GET", url: "/api/v1/deliveries/eligible-orders", headers: { cookie } })).json() as Array<{ id: string }>;
    expect(orders.find((o) => o.id === orderId)).toBeUndefined();
  });

  it("rattache la preuve de livraison signée (scan/photo) et l'expose au registre + en consultation", async () => {
    expect(firstDeliveryId).toBeTruthy();
    // Avant : aucune preuve.
    const before = (await app.inject({ method: "GET", url: "/api/v1/deliveries", headers: { cookie } })).json() as Array<{ id: string; has_proof: boolean }>;
    expect(before.find((d) => d.id === firstDeliveryId)!.has_proof).toBe(false);

    // Téléversement d'une image (preuve signée).
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const mp = multipartFile("bl-signe.png", "image/png", png);
    const up = await app.inject({ method: "POST", url: `/api/v1/deliveries/${firstDeliveryId}/proof`, headers: { cookie, "content-type": mp.contentType }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    expect(up.json().has_proof).toBe(true);

    // Le registre marque désormais la livraison comme ayant une preuve.
    const after = (await app.inject({ method: "GET", url: "/api/v1/deliveries", headers: { cookie } })).json() as Array<{ id: string; has_proof: boolean; proof_version_id: string | null }>;
    const row = after.find((d) => d.id === firstDeliveryId)!;
    expect(row.has_proof).toBe(true);
    expect(row.proof_version_id).toBeTruthy();

    // La consultation renvoie bien le fichier (même type MIME).
    const view = await app.inject({ method: "GET", url: `/api/v1/deliveries/${firstDeliveryId}/proof`, headers: { cookie } });
    expect(view.statusCode).toBe(200);
    expect(view.headers["content-type"]).toContain("image/png");
    expect(view.rawPayload.length).toBe(png.length);
  });
});
