import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

// IMPRESSION à DOUBLE validation (demande opérateur 15/10/2026), même principe
// que le BAT Final : l'opérateur d'impression (printing:saisie) pose la 1re
// signature (pré-validation, pas d'avancement) ; la Direction générale
// contre-valide (2e signature) et l'ouvrage avance seulement alors. La
// contre-validation est interdite au pré-validateur (deux personnes distinctes).
describe("Impression — double validation (opérateur puis Direction générale)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let opCookie: string;
  let dgCookie: string;
  let dgId: string;
  let impressionStatusId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    impressionStatusId = (await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "IMPRESSION" } })).id;

    await createUserWithRole("op_impression_dv", "RESP_IMPRESSION", "OpImp123!");
    const dg = await createUserWithRole("dg_impression_dv", "DIR_GENERAL", "DirImp123!");
    dgId = dg.id;
    opCookie = await loginCookie(app, "op_impression_dv", "OpImp123!");
    dgCookie = await loginCookie(app, "dg_impression_dv", "DirImp123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Place un manuscrit à l'étape IMPRESSION avec un bon de commande « transmis »
  // (prérequis métier), via la base pour rester concis.
  async function manuscriptAtImpression(baseTitle: string, opts: { withOrder?: boolean } = {}) {
    const withOrder = opts.withOrder ?? true;
    const title = `${baseTitle} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } },
    });
    const manuscript = createResponse.json();
    if (!manuscript?.id) throw new Error(`manuscript create failed ${createResponse.statusCode}: ${createResponse.body.slice(0, 300)}`);

    await prisma.manuscript.update({ where: { id: manuscript.id }, data: { statusId: impressionStatusId } });

    if (withOrder) {
      const partner = await prisma.partner.create({ data: { category: "imprimeur", firstName: "", lastName: `Imprimeur ${title}`, createdBy: adminId, updatedBy: adminId } });
      const printer = await prisma.printer.create({ data: { partnerId: partner.id } });
      const quote = await prisma.printQuote.create({ data: { manuscriptId: manuscript.id, printerId: printer.id, quantities: [1000], status: "selected" } });
      await prisma.purchaseOrder.create({
        data: { quoteId: quote.id, printerId: printer.id, poNumber: `PO-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, orderedQuantity: 1000, amount: "1000000", status: "sent" },
      });
    }

    return manuscript;
  }

  it("refuse la pré-validation tant qu'aucun bon de commande n'est transmis", async () => {
    const manuscript = await manuscriptAtImpression("Imp DV Sans Commande", { withOrder: false });
    const pre = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: opCookie }, payload: {} });
    expect(pre.statusCode).toBe(409);
    expect(pre.json().code).toBe("purchase_order_not_sent");
  });

  it("l'opérateur pré-valide (1re signature) sans faire avancer l'ouvrage et notifie la Direction générale", async () => {
    const manuscript = await manuscriptAtImpression("Imp DV Prevalidation");
    const pre = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: opCookie }, payload: {} });
    expect(pre.statusCode).toBe(200);
    expect(pre.json().advanced).toBe(false);
    expect(pre.json().pending_counter_validation).toBe(true);

    const after = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id }, select: { statusId: true } });
    expect(after.statusId).toBe(impressionStatusId);
    const step = await prisma.manuscriptStep.findUniqueOrThrow({ where: { manuscriptId_statusId: { manuscriptId: manuscript.id, statusId: impressionStatusId } } });
    expect(step.preValidatedAt).not.toBeNull();
    expect(step.validatedAt).toBeNull();

    const notif = await prisma.notification.findFirst({ where: { userId: dgId, entityId: manuscript.id, title: { startsWith: "Impression à contre-valider" } } });
    expect(notif).not.toBeNull();
  });

  it("l'opérateur ne peut pas contre-valider (réservé à la Direction générale)", async () => {
    const manuscript = await manuscriptAtImpression("Imp DV Refus Contre");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: opCookie }, payload: {} });
    const second = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: opCookie }, payload: {} });
    expect(second.statusCode).toBe(403);
    expect(second.json().code).toBe("forbidden");
  });

  it("la Direction générale contre-valide (2e signature) : l'ouvrage avance enfin", async () => {
    const manuscript = await manuscriptAtImpression("Imp DV Contre Validation");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: opCookie }, payload: {} });

    const counter = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: dgCookie }, payload: {} });
    expect(counter.statusCode).toBe(200);
    expect(counter.json().advanced).toBe(true);

    const after = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id }, select: { statusId: true } });
    expect(after.statusId).not.toBe(impressionStatusId);
    const step = await prisma.manuscriptStep.findUniqueOrThrow({ where: { manuscriptId_statusId: { manuscriptId: manuscript.id, statusId: impressionStatusId } } });
    expect(step.validatedAt).not.toBeNull();
    expect(step.validationBy).toBe(dgId);
  });

  it("le pré-validateur ne peut pas être aussi le contre-validateur (double signature de deux personnes)", async () => {
    const manuscript = await manuscriptAtImpression("Imp DV Meme Signataire");
    const pre = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(pre.json().pending_counter_validation).toBe(true);

    const self = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("impression_same_signer");

    const counter = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: dgCookie }, payload: {} });
    expect(counter.statusCode).toBe(200);
    expect(counter.json().advanced).toBe(true);
  });

  it("expose l'état de double validation de l'impression (endpoint bat-validation-state)", async () => {
    const manuscript = await manuscriptAtImpression("Imp DV Etat");

    const before = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/bat-validation-state`, headers: { cookie: dgCookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json().at_bat).toBe(true);
    expect(before.json().step_code).toBe("IMPRESSION");
    expect(before.json().pre_validated).toBe(false);

    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/IMPRESSION/validate`, headers: { cookie: opCookie }, payload: {} });

    const afterDg = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/bat-validation-state`, headers: { cookie: dgCookie } });
    expect(afterDg.json().pre_validated).toBe(true);
    expect(afterDg.json().can_counter_validate).toBe(true);

    const afterOp = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/bat-validation-state`, headers: { cookie: opCookie } });
    expect(afterOp.json().is_pre_validator).toBe(true);
    expect(afterOp.json().can_counter_validate).toBe(false);
  });
});
