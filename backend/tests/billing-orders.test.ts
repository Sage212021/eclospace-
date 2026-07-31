import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Commandes à facturer (Finance étape 3) : création (DG/commercial/finance),
// établissement de la facture par la Finance, validation par seuil.

const PWD = "BillTest123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("commandes à facturer + validation par seuil", () => {
  let app: FastifyInstance;
  let admin = "";
  let magasinier = "";
  let customerId = "";
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];

  const login = async (u: string, p = PWD) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    const mag = `mag_${rnd()}`;
    await createUserWithRole(mag, "MAGASINIER", PWD);
    const customer = await prisma.customer.create({ data: { category: "particulier", name: `Lycée ${rnd()}` } });
    customerId = customer.id;
    // Seuil de validation à 1 000 000 pour ce test (indépendant du défaut).
    await prisma.setting.upsert({ where: { key: "finance.validation_threshold" }, create: { key: "finance.validation_threshold", value: 1_000_000 }, update: { value: 1_000_000 } });
    admin = await login("admin", "TestAdmin123!");
    magasinier = await login(mag);
  });

  afterAll(async () => {
    await prisma.billingOrder.updateMany({ where: { id: { in: orderIds } }, data: { invoiceId: null } });
    await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.installment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.billingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await app.close();
  });

  async function createOrder(amountHt: number) {
    const res = await app.inject({ method: "POST", url: "/api/v1/billing-orders", headers: { cookie: admin }, payload: { customer_id: customerId, category: "livre_scolaire", label: `Manuels ${rnd()}`, amount_ht: amountHt, tax_rate: 0 } });
    if (res.statusCode === 201) orderIds.push(res.json().id);
    return res;
  }

  it("notifie le pôle Finance mais PAS l'administrateur général", async () => {
    // Un comptable (finance:saisie) reçoit la notification ; l'admin non.
    const comptaU = `compta_${rnd()}`;
    const compta = await createUserWithRole(comptaU, "COMPTABLE", PWD);
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });

    const before = { compta: 0, admin: 0 };
    before.compta = await prisma.notification.count({ where: { userId: compta.id, entityType: "billing_order" } });
    before.admin = await prisma.notification.count({ where: { userId: adminUser.id, entityType: "billing_order" } });

    const res = await createOrder(300_000);
    expect(res.statusCode).toBe(201);

    const afterCompta = await prisma.notification.count({ where: { userId: compta.id, entityType: "billing_order" } });
    const afterAdmin = await prisma.notification.count({ where: { userId: adminUser.id, entityType: "billing_order" } });
    expect(afterCompta).toBe(before.compta + 1); // le comptable est notifié
    expect(afterAdmin).toBe(before.admin); // l'administrateur ne l'est pas
  });

  it("crée une commande à facturer et l'affiche dans la file", async () => {
    const res = await createOrder(500_000);
    expect(res.statusCode).toBe(201);
    expect(res.json().reference).toMatch(/^CMD-\d{4}-\d{4}$/);

    const list = await app.inject({ method: "GET", url: "/api/v1/billing-orders?status=pending", headers: { cookie: admin } });
    expect((list.json() as { id: string }[]).some((o) => o.id === res.json().id)).toBe(true);
  });

  it("un rôle non habilité ne peut pas créer de commande (403)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/billing-orders", headers: { cookie: magasinier }, payload: { customer_id: customerId, category: "livre_scolaire", label: "X", amount_ht: 1000, tax_rate: 0 } });
    expect(res.statusCode).toBe(403);
  });

  it("sous le seuil : la facture est émise directement", async () => {
    const order = await createOrder(500_000);
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/invoice`, headers: { cookie: admin } });
    expect(inv.statusCode).toBe(201);
    invoiceIds.push(inv.json().id);
    expect(inv.json().status).toBe("issued");
    expect(inv.json().needs_validation).toBe(false);
  });

  it("au-dessus du seuil : la facture attend la validation du DG, puis est validée", async () => {
    const order = await createOrder(2_000_000);
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/invoice`, headers: { cookie: admin } });
    expect(inv.statusCode).toBe(201);
    invoiceIds.push(inv.json().id);
    expect(inv.json().status).toBe("pending_validation");

    const pending = await app.inject({ method: "GET", url: "/api/v1/invoices/pending-validation", headers: { cookie: admin } });
    expect((pending.json() as { id: string }[]).some((i) => i.id === inv.json().id)).toBe(true);

    const val = await app.inject({ method: "POST", url: `/api/v1/invoices/${inv.json().id}/validate`, headers: { cookie: admin } });
    expect(val.statusCode).toBe(200);
    expect(val.json().status).toBe("issued");
  });

  it("une commande déjà facturée ne peut pas l'être à nouveau (409)", async () => {
    const order = await createOrder(300_000);
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/invoice`, headers: { cookie: admin } });
    invoiceIds.push(inv.json().id);
    const again = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/invoice`, headers: { cookie: admin } });
    expect(again.statusCode).toBe(409);
  });

  it("le commercial peut annuler une commande (client désisté) ; elle quitte la file", async () => {
    const com = `comx_${rnd()}`;
    await createUserWithRole(com, "RESP_COMMERCIAL", PWD);
    const comCookie = await login(com);
    const order = await createOrder(90_000);
    const cancel = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/cancel`, headers: { cookie: comCookie }, payload: { reason: "Client désisté" } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("cancelled");
    // Elle ne figure plus dans la file « en attente ».
    const list = await app.inject({ method: "GET", url: "/api/v1/billing-orders?status=pending", headers: { cookie: admin } });
    expect((list.json() as { id: string }[]).some((o) => o.id === order.json().id)).toBe(false);
  });

  it("une commande déjà facturée ne peut pas être annulée (409 → avoir)", async () => {
    const order = await createOrder(80_000);
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/invoice`, headers: { cookie: admin } });
    invoiceIds.push(inv.json().id);
    const cancel = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/cancel`, headers: { cookie: admin }, payload: {} });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().code).toBe("already_invoiced");
  });

  it("un rôle non habilité ne peut pas annuler une commande (403)", async () => {
    const order = await createOrder(70_000);
    const cancel = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/cancel`, headers: { cookie: magasinier }, payload: {} });
    expect(cancel.statusCode).toBe(403);
  });

  it("le commercial initie une commande et la voit, mais ne peut pas la facturer", async () => {
    const com = `com_${rnd()}`;
    await createUserWithRole(com, "RESP_COMMERCIAL", PWD);
    const comCookie = await login(com);
    // création : autorisée
    const create = await app.inject({ method: "POST", url: "/api/v1/billing-orders", headers: { cookie: comCookie }, payload: { customer_id: customerId, category: "livre_scolaire", label: `Commercial ${rnd()}`, amount_ht: 120_000, tax_rate: 0 } });
    expect(create.statusCode).toBe(201);
    orderIds.push(create.json().id);
    // lecture de la file : autorisée
    const list = await app.inject({ method: "GET", url: "/api/v1/billing-orders?status=pending", headers: { cookie: comCookie } });
    expect(list.statusCode).toBe(200);
    // établir la facture : réservé à la Finance → refusé
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${create.json().id}/invoice`, headers: { cookie: comCookie } });
    expect(inv.statusCode).toBe(403);
  });
});
