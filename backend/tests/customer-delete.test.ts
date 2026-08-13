import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Suppression LOGIQUE d'un client (nettoyage des fiches de test / doublons),
// bloquée si le client a un historique comptable.

describe("suppression logique d'un client", () => {
  let app: FastifyInstance;
  let cookie: string;
  const tag = `DEL-${Date.now()}`;

  beforeAll(async () => {
    app = await buildApp();
    await createUserWithRole("com_del", "RESP_COMMERCIAL", "ComDel123!");
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "com_del", password: "ComDel123!" } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await prisma.posSale.deleteMany({ where: { offCatalogueTitle: { startsWith: tag } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { name: { startsWith: tag } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  async function createCustomer(name: string) {
    const res = await app.inject({ method: "POST", url: "/api/v1/customers", headers: { cookie }, payload: { category: "particulier", name } });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it("supprime un client SANS historique et le retire de la liste", async () => {
    const id = await createCustomer(`${tag} À supprimer`);
    const del = await app.inject({ method: "DELETE", url: `/api/v1/customers/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);

    // Absent de la liste et introuvable (suppression logique = deletedAt).
    const list = await app.inject({ method: "GET", url: "/api/v1/customers", headers: { cookie } });
    expect((list.json() as Array<{ id: string }>).some((c) => c.id === id)).toBe(false);
    const row = await prisma.customer.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("REFUSE la suppression d'un client ayant un historique (409)", async () => {
    const id = await createCustomer(`${tag} Avec historique`);
    // Un enregistrement de vente rattaché suffit à constituer un historique.
    await prisma.posSale.create({ data: { offCatalogueTitle: `${tag} Vente`, quantity: 1, unitPrice: "1000.00", paymentMethod: "cash", customerId: id } });

    const del = await app.inject({ method: "DELETE", url: `/api/v1/customers/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("customer_has_history");

    // Le client reste actif (non supprimé).
    const row = await prisma.customer.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("renvoie 404 pour un client inexistant", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/v1/customers/00000000-0000-0000-0000-000000000000`, headers: { cookie } });
    expect(del.statusCode).toBe(404);
  });
});
