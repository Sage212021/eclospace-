import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Encaissement éditorial (AuthorReceipt) → BILAN : à la comptabilisation
// (validation financière DAF), une entrée financière (Payment « in ») est créée
// et alimente le bilan du MOIS de l'encaissement. Avant : aucun impact. + alerte DAF.
const PWD = "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const YEAR = 2013; // année passée isolée
const MONTH0 = 6; // juillet
const PAID_AT = `${YEAR}-07-10`;
const AMOUNT = 48000;

async function loginCookie(app: FastifyInstance, u: string, p: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}
async function monthEntrees(app: FastifyInstance, cookie: string): Promise<number> {
  const r = await app.inject({ method: "GET", url: `/api/v1/finance/monthly-balance?year=${YEAR}`, headers: { cookie } });
  return (r.json() as { months: { entrees: number }[] }).months[MONTH0].entrees;
}

describe("Encaissement éditorial → entrée financière & bilan (validation DAF)", () => {
  let app: FastifyInstance;
  let cookie: string; // admin : crée / contrôle / comptabilise
  let dafUser: string;
  let manuscriptId: string;
  let partnerId: string;
  let receiptId = "";
  const s = rnd();

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app, "admin", PWD);
    dafUser = `daf_bil_${rnd()}`;
    await createUserWithRole(dafUser, "RESP_FINANCE", PWD);
    const partner = await prisma.partner.create({ data: { firstName: "Awa", lastName: `Enc ${s}`, phone: "690000111" } });
    partnerId = partner.id;
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-ENC-${s}`, title: `Encaissement ${s}`, language: "fr", statusId: status.id, ownerId: admin.id, receivedAt: new Date(), createdBy: admin.id, updatedBy: admin.id } });
    manuscriptId = m.id;
    await prisma.workContributor.create({ data: { manuscriptId, partnerId, role: "author", displayOrder: 0 } });
  });

  afterAll(async () => {
    const r = receiptId ? await prisma.authorReceipt.findUnique({ where: { id: receiptId }, select: { paymentId: true } }) : null;
    if (r?.paymentId) await prisma.payment.deleteMany({ where: { id: r.paymentId } }).catch(() => {});
    await prisma.authorReceipt.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.workContributor.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.partner.deleteMany({ where: { id: partnerId } }).catch(() => {});
    try { await prisma.user.updateMany({ where: { username: dafUser }, data: { status: "disabled" } }); } catch { /* non bloquant */ }
    await app.close();
    await prisma.$disconnect();
  });

  it("création → en attente, AUCUN impact bilan, et le DAF est alerté", async () => {
    const before = await monthEntrees(app, cookie);
    const c = await app.inject({
      method: "POST", url: "/api/v1/author-receipts", headers: { cookie },
      payload: { manuscript_id: manuscriptId, type: "prestation_editoriale", service_label: "Frais de travaux éditoriaux", amount: AMOUNT, method: "cash", paid_at: PAID_AT },
    });
    expect(c.statusCode).toBe(201);
    receiptId = (c.json() as { id: string }).id;
    // Pas d'entrée financière tant que non comptabilisé.
    const detail = (await app.inject({ method: "GET", url: `/api/v1/author-receipts/${receiptId}`, headers: { cookie } })).json() as { status: string };
    expect(detail.status).toBe("enregistre");
    expect(await prisma.authorReceipt.findUniqueOrThrow({ where: { id: receiptId } }).then((r) => r.paymentId)).toBeNull();
    expect(await monthEntrees(app, cookie)).toBe(before);
    // Le DAF a reçu l'alerte.
    const dafId = (await prisma.user.findFirstOrThrow({ where: { username: dafUser } })).id;
    const alert = await prisma.notification.findFirst({ where: { userId: dafId, entityType: "author_receipt", entityId: receiptId } });
    expect(alert).not.toBeNull();
  });

  it("comptabilisation (DAF) → entrée financière créée dans le mois, bilan mis à jour", async () => {
    const before = await monthEntrees(app, cookie);
    await app.inject({ method: "POST", url: `/api/v1/author-receipts/${receiptId}/control`, headers: { cookie }, payload: {} });
    const acc = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${receiptId}/account`, headers: { cookie }, payload: { accounting_ref: "PIECE-ENC-1" } });
    expect(acc.statusCode).toBe(200);
    const row = await prisma.authorReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(row.status).toBe("comptabilise");
    expect(row.paymentId).not.toBeNull();
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentId! } });
    expect(pay.direction).toBe("in");
    expect(Number(pay.amount)).toBe(AMOUNT);
    expect(pay.receivedAt.toISOString().slice(0, 7)).toBe(`${YEAR}-07`);
    expect(pay.reference).toBe(row.receiptNumber);
    // Bilan du mois : +montant.
    expect(await monthEntrees(app, cookie)).toBe(before + AMOUNT);
  });

  it("pas de double entrée : une seconde comptabilisation est refusée (409)", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/author-receipts/${receiptId}/account`, headers: { cookie }, payload: {} });
    expect(r.statusCode).toBe(409);
    const payments = await prisma.payment.count({ where: { reference: (await prisma.authorReceipt.findUniqueOrThrow({ where: { id: receiptId } })).receiptNumber, direction: "in" } });
    expect(payments).toBe(1);
  });
});
