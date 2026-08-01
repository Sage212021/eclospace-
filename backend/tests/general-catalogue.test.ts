import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Catalogue des livres GÉNÉRAUX / simples : mêmes principes que le scolaire —
// les ouvrages du catalogue (segment « general ») sont sélectionnables dans une
// commande à facturer de catégorie « livre_general », groupés par collection.
// On vérifie l'exposition du segment au sélecteur, et le flux commande → facture
// avec un ouvrage général (droits d'auteur par livre + famille « livre_general »).

const rnd = () => Math.random().toString(36).slice(2, 7);

describe("catalogue des livres généraux (sélection à la commande)", () => {
  let app: FastifyInstance;
  let admin = "";
  let customerId = "";
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    admin = await login("admin", "TestAdmin123!");
    const c = await prisma.customer.create({ data: { category: "librairie", name: `Librairie ${rnd()}` } });
    customerId = c.id;
    // Seuil neutre : la facture s'émet directement (pas de validation par seuil ici).
    await prisma.setting.upsert({ where: { key: "finance.validation_threshold" }, create: { key: "finance.validation_threshold", value: 0 }, update: { value: 0 } });
  });

  afterAll(async () => {
    await prisma.billingOrder.updateMany({ where: { id: { in: orderIds } }, data: { invoiceId: null } });
    await prisma.schoolRoyaltyEntry.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.billingOrderLine.deleteMany({ where: { billingOrderId: { in: orderIds } } });
    await prisma.billingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await app.close();
  });

  it("expose les ouvrages généraux au sélecteur, avec segment et collection", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/isbns?format=print", headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { manuscript: { title: string; subtitle?: string | null; editorialSegment?: string | null } | null }[];
    const general = items.filter((i) => i.manuscript?.editorialSegment === "general");
    // Le catalogue général du seed est présent et porte sa collection en sous-titre.
    expect(general.length).toBeGreaterThanOrEqual(13);
    expect(general.every((g) => (g.manuscript?.subtitle ?? "").length > 0)).toBe(true);
    expect(general.some((g) => g.manuscript?.subtitle === "Collection Source")).toBe(true);
    // Et le scolaire reste dissociable (segment distinct).
    expect(items.some((i) => i.manuscript?.editorialSegment === "scolaire")).toBe(true);
  });

  it("commande « livre_general » avec un ouvrage du catalogue → facture, droits par livre, famille générale", async () => {
    const gIsbn = await prisma.isbn.findFirst({
      where: { format: "print", manuscript: { editorialSegment: "general" } },
      include: { manuscript: true },
    });
    expect(gIsbn).not.toBeNull();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/billing-orders",
      headers: { cookie: admin },
      payload: {
        customer_id: customerId,
        category: "livre_general",
        label: `Roman — ${rnd()}`,
        tax_rate: 0,
        lines: [{ isbn_id: gIsbn!.id, description: gIsbn!.manuscript!.title, quantity: 100, unit_price_ht: 3000 }],
      },
    });
    expect(create.statusCode).toBe(201);
    const order = create.json();
    orderIds.push(order.id);
    expect(order.category).toBe("livre_general");

    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.id}/invoice`, headers: { cookie: admin }, payload: {} });
    expect(inv.statusCode).toBe(201);
    const invoice = inv.json();
    invoiceIds.push(invoice.id);

    // Droits d'auteur enregistrés par livre (12 % par défaut) sur cet ouvrage général.
    const entries = await prisma.schoolRoyaltyEntry.findMany({ where: { invoiceId: invoice.id } });
    expect(entries.length).toBe(1);
    expect(entries[0].quantity).toBe(100);
    expect(Number(entries[0].rateApplied)).toBeCloseTo(0.12, 5);

    // La facture est classée dans la famille « livre général » (via le segment de la ligne).
    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { lines: { include: { isbn: { include: { manuscript: true } } } }, billingOrder: true },
    });
    expect(stored.billingOrder?.category).toBe("livre_general");
    expect(stored.lines[0].isbn?.manuscript?.editorialSegment).toBe("general");
  });
});
