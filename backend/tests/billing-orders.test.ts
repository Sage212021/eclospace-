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

  it("au-dessus du seuil : la Finance ne peut ni valider ni refuser (réservé DG / admin)", async () => {
    const dafU = `daf_seuil_${rnd()}`;
    await createUserWithRole(dafU, "RESP_FINANCE", PWD);
    const dafCookie = await login(dafU);

    const order = await createOrder(2_000_000);
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/invoice`, headers: { cookie: admin } });
    invoiceIds.push(inv.json().id);
    expect(inv.json().status).toBe("pending_validation");

    // La Finance (finance:administration, sans pilotage:administration) : refusée.
    const val = await app.inject({ method: "POST", url: `/api/v1/invoices/${inv.json().id}/validate`, headers: { cookie: dafCookie } });
    expect(val.statusCode).toBe(403);
    const rej = await app.inject({ method: "POST", url: `/api/v1/invoices/${inv.json().id}/validate-reject`, headers: { cookie: dafCookie }, payload: { reason: "x" } });
    expect(rej.statusCode).toBe(403);

    // Le DG / administrateur général valide.
    const ok = await app.inject({ method: "POST", url: `/api/v1/invoices/${inv.json().id}/validate`, headers: { cookie: admin } });
    expect(ok.statusCode).toBe(200);
  });

  it("au-dessus du seuil : le DG peut REFUSER — facture annulée, commande à refacturer", async () => {
    const order = await createOrder(2_000_000);
    const orderId = order.json().id as string;
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${orderId}/invoice`, headers: { cookie: admin } });
    invoiceIds.push(inv.json().id);
    expect(inv.json().status).toBe("pending_validation");

    // Refus sans motif : refusé.
    const noReason = await app.inject({ method: "POST", url: `/api/v1/invoices/${inv.json().id}/validate-reject`, headers: { cookie: admin }, payload: {} });
    expect(noReason.statusCode).toBe(400);

    // Refus avec motif : la facture passe « annulée » et la commande repasse « pending ».
    const rej = await app.inject({ method: "POST", url: `/api/v1/invoices/${inv.json().id}/validate-reject`, headers: { cookie: admin }, payload: { reason: "Montant à revoir" } });
    expect(rej.statusCode).toBe(200);
    expect(rej.json().status).toBe("cancelled");

    const invoice = await prisma.invoice.findUnique({ where: { id: inv.json().id } });
    expect(invoice?.status).toBe("cancelled");
    const bo = await prisma.billingOrder.findUnique({ where: { id: orderId } });
    expect(bo?.status).toBe("pending");
    expect(bo?.invoiceId).toBeNull();

    // Elle n'est plus dans la file « à valider ».
    const pending = await app.inject({ method: "GET", url: "/api/v1/invoices/pending-validation", headers: { cookie: admin } });
    expect((pending.json() as { id: string }[]).some((i) => i.id === inv.json().id)).toBe(false);

    // La commande peut être refacturée.
    const inv2 = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${orderId}/invoice`, headers: { cookie: admin } });
    expect(inv2.statusCode).toBe(201);
    invoiceIds.push(inv2.json().id);
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

  // --- Annulation d'une facture, validée par le DG ---------------------------
  async function issueInvoice(amountHt: number): Promise<string> {
    const order = await createOrder(amountHt);
    const inv = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${order.json().id}/invoice`, headers: { cookie: admin } });
    invoiceIds.push(inv.json().id);
    return inv.json().id as string;
  }

  it("la demande d'annulation notifie le décideur (DG / administrateur général)", async () => {
    // Le comptable (finance:saisie, sans administration) demande l'annulation ;
    // l'administrateur général — décideur habilité — doit en être notifié, faute
    // de quoi la demande n'atteindrait personne dans une structure sans compte DG dédié.
    const comptaU = `compta_notif_${rnd()}`;
    const compta = await createUserWithRole(comptaU, "COMPTABLE", PWD);
    const comptaCookie = await login(comptaU);
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });

    const invId = await issueInvoice(120_000);
    const before = await prisma.notification.count({ where: { userId: adminUser.id, entityType: "invoice", entityId: invId } });

    const req = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/request-cancellation`, headers: { cookie: comptaCookie }, payload: { reason: "Erreur client" } });
    expect(req.statusCode).toBe(200);

    const after = await prisma.notification.count({ where: { userId: adminUser.id, entityType: "invoice", entityId: invId } });
    expect(after).toBe(before + 1); // le DG (admin général) est notifié
    // Le demandeur ne se notifie pas lui-même.
    const selfNotif = await prisma.notification.count({ where: { userId: compta.id, entityType: "invoice", entityId: invId } });
    expect(selfNotif).toBe(0);
  });

  it("séparation des pouvoirs : la Finance ne peut PAS valider une annulation (réservé DG / admin)", async () => {
    // Le responsable financier détient finance:administration mais PAS
    // pilotage:administration : il peut demander l'annulation, pas la valider.
    const dafU = `daf_sep_${rnd()}`;
    await createUserWithRole(dafU, "RESP_FINANCE", PWD);
    const dafCookie = await login(dafU);

    const invId = await issueInvoice(130_000);
    const req = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/request-cancellation`, headers: { cookie: dafCookie }, payload: { reason: "Erreur" } });
    expect(req.statusCode).toBe(200);

    // La Finance tente de valider / refuser sa propre demande : refusé (403).
    const approve = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/cancel-approve`, headers: { cookie: dafCookie } });
    expect(approve.statusCode).toBe(403);
    const reject = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/cancel-reject`, headers: { cookie: dafCookie } });
    expect(reject.statusCode).toBe(403);

    // Le DG / administrateur général, lui, valide.
    const approveDg = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/cancel-approve`, headers: { cookie: admin } });
    expect(approveDg.statusCode).toBe(200);
    expect(approveDg.json().status).toBe("cancelled");
  });

  it("le comptable demande l'annulation, le DG la valide → facture annulée", async () => {
    const invId = await issueInvoice(150_000);
    const req = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/request-cancellation`, headers: { cookie: admin }, payload: { reason: "Erreur de saisie" } });
    expect(req.statusCode).toBe(200);
    expect(req.json().status).toBe("cancellation_requested");

    const pending = await app.inject({ method: "GET", url: "/api/v1/invoices/pending-cancellation", headers: { cookie: admin } });
    expect((pending.json() as { id: string }[]).some((i) => i.id === invId)).toBe(true);

    const approve = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/cancel-approve`, headers: { cookie: admin } });
    expect(approve.statusCode).toBe(200);
    const inv = await prisma.invoice.findUnique({ where: { id: invId } });
    expect(inv?.status).toBe("cancelled");
  });

  it("le DG peut refuser l'annulation → la facture reste émise", async () => {
    const invId = await issueInvoice(140_000);
    await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/request-cancellation`, headers: { cookie: admin }, payload: { reason: "Doute" } });
    const reject = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/cancel-reject`, headers: { cookie: admin } });
    expect(reject.statusCode).toBe(200);
    const inv = await prisma.invoice.findUnique({ where: { id: invId } });
    expect(inv?.status).toBe("issued");
    expect(inv?.cancellationReason).toBeNull();
  });

  it("une facture déjà TIRÉE (imprimée) ne peut plus être annulée (409)", async () => {
    const invId = await issueInvoice(130_000);
    const mark = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/mark-printed`, headers: { cookie: admin } });
    expect(mark.statusCode).toBe(200);
    const req = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/request-cancellation`, headers: { cookie: admin }, payload: { reason: "Trop tard" } });
    expect(req.statusCode).toBe(409);
    expect(req.json().code).toBe("already_printed");
  });

  it("l'annulation exige un motif (400 si absent)", async () => {
    const invId = await issueInvoice(120_000);
    const req = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/request-cancellation`, headers: { cookie: admin }, payload: {} });
    expect(req.statusCode).toBe(400);
  });

  it("établit un avoir sur une facture (neutralisation) ; un seul avoir possible", async () => {
    const invId = await issueInvoice(160_000);
    // Une facture tirée n'est plus annulable → l'avoir est la voie légale.
    await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/mark-printed`, headers: { cookie: admin } });
    const cn = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/credit-note`, headers: { cookie: admin }, payload: { reason: "Facture erronée" } });
    expect(cn.statusCode).toBe(201);
    invoiceIds.push(cn.json().id);
    const credit = await prisma.invoice.findUnique({ where: { id: cn.json().id } });
    expect(credit?.type).toBe("credit_note");
    expect(credit?.parentInvoiceId).toBe(invId);
    // Un second avoir sur la même facture est refusé.
    const again = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/credit-note`, headers: { cookie: admin }, payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_credited");
  });

  it("ventile le CA par famille : une facture non réglée alimente facturé et créances (livre scolaire)", async () => {
    type Fam = { key: string; facture: number; encaisse: number; creances: number };
    type Resp = { families: Fam[]; total: { facture: number; encaisse: number; creances: number } };
    const get = async (): Promise<Resp> => (await app.inject({ method: "GET", url: "/api/v1/dashboard/revenue-by-family", headers: { cookie: admin } })).json() as Resp;
    const before = await get();
    const bScol = before.families.find((f) => f.key === "livre_scolaire")!;
    await issueInvoice(200_000); // commande livre_scolaire, taxe 0 → TTC 200 000, non réglée
    const after = await get();
    const aScol = after.families.find((f) => f.key === "livre_scolaire")!;
    expect(aScol.facture - bScol.facture).toBeCloseTo(200_000, 2);
    expect(aScol.creances - bScol.creances).toBeCloseTo(200_000, 2);
    expect(aScol.encaisse).toBeCloseTo(bScol.encaisse, 2); // rien d'encaissé
    expect(after.total.facture - before.total.facture).toBeCloseTo(200_000, 2);
  });

  it("un avoir retire la facture du CA (facturé net revient à zéro)", async () => {
    type Fam = { key: string; facture: number };
    const get = async () => ((await app.inject({ method: "GET", url: "/api/v1/dashboard/revenue-by-family", headers: { cookie: admin } })).json() as { families: Fam[] }).families.find((f) => f.key === "livre_scolaire")!.facture;
    const invId = await issueInvoice(180_000);
    const mid = await get();
    const cn = await app.inject({ method: "POST", url: `/api/v1/invoices/${invId}/credit-note`, headers: { cookie: admin }, payload: { reason: "Correction" } });
    invoiceIds.push(cn.json().id);
    const after = await get();
    // L'avoir (même montant) annule la facture : le facturé net redescend.
    expect(mid - after).toBeCloseTo(180_000, 2);
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
