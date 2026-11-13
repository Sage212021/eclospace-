import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, seedStepDeliverable } from "./helpers.js";

// CLÔTURE DE L'INFOGRAPHIE (demande opérateur 27/09/2026) : même principe que la
// mise en page — l'infographe affecté valide et choisit qui reçoit la suite.
// Depuis D-055 (ISBN remonté avant l'infographie), l'étape qui suit est la
// VALIDATION DU BAT (contrôle qualité). Directeur éditorial + Responsable
// production/impression notifiés. Un infographe non affecté ne peut pas clôturer.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("clôture de l'infographie par l'infographe", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function login(username: string, password: string) {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
    return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  }

  // Ouvrage à l'étape INFOGRAPHIE, convergence Maquette/Infographie satisfaite
  // (fiche technique complète + couverture conforme avec droits) et livrable déposé.
  async function manuscriptAtInfographie(infographeId: string, opts: { converged: boolean }) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "INFOGRAPHIE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-INF-${rnd()}`, title: `Infographie ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: infographeId, actualStart: new Date() } });
    if (opts.converged) {
      await prisma.productionSpecs.create({ data: { manuscriptId: m.id, trimFormat: "14x21", finalPages: 200, paperInterior: "Offset 80g", paperCover: "Couché 250g", binding: "broche", spineNeedsRecalc: false } });
      await prisma.imageAsset.create({ data: { manuscriptId: m.id, type: "couverture_1", technicalOk: true, rightsOrigin: "creation_interne" } });
      await seedStepDeliverable(m.id, "INFOGRAPHIE");
    }
    return m;
  }

  it("l'infographe affecté valide et transmet au contrôle qualité (BAT) ; DIRED + RESP production notifiés", async () => {
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const cq = await createUserWithRole(`cq_${rnd()}`, "RESP_QUALITE", "Cq123!");
    const dir = await createUserWithRole(`dir_${rnd()}`, "DIR_EDITORIAL", "Dir123!");
    const prod = await createUserWithRole(`prod_${rnd()}`, "RESP_IMPRESSION", "Prod123!");
    const infoCookie = await login(info.username, "Info123!");
    const m = await manuscriptAtInfographie(info.id, { converged: true });

    // D-055 : après l'infographie, l'étape suivante est la Validation du BAT
    // (contrôle qualité) — l'infographe la confie au responsable qualité.
    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/INFOGRAPHIE/validate`, headers: { cookie: infoCookie }, payload: { assignee_id: cq.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("VALIDATION_BAT");

    const batStatus = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "VALIDATION_BAT" } });
    const nextStep = await prisma.manuscriptStep.findUnique({ where: { manuscriptId_statusId: { manuscriptId: m.id, statusId: batStatus.id } } });
    expect(nextStep?.responsibleId).toBe(cq.id);

    const dirNotif = await prisma.notification.count({ where: { userId: dir.id, entityId: m.id, title: { contains: "Infographie clôturée" } } });
    const prodNotif = await prisma.notification.count({ where: { userId: prod.id, entityId: m.id, title: { contains: "Infographie clôturée" } } });
    expect(dirNotif).toBeGreaterThan(0);
    expect(prodNotif).toBeGreaterThan(0);
  });

  it("l'infographe affecté passe le contrôle de permission (409 convergence, pas 403) quand la convergence manque", async () => {
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const infoCookie = await login(info.username, "Info123!");
    const m = await manuscriptAtInfographie(info.id, { converged: false });
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/INFOGRAPHIE/validate`, headers: { cookie: infoCookie }, payload: {} });
    expect(res.statusCode).toBe(409); // bloqué par la convergence, PAS par la permission (403)
    expect(res.json().code).toBe("maquette_infographie_incomplete");
  });

  it("dossier NON assigné (« à tout le service ») : un infographe du métier peut le clôturer (200)", async () => {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "INFOGRAPHIE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const cq = await createUserWithRole(`cq_${rnd()}`, "RESP_QUALITE", "Cq123!");
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-INF-${rnd()}`, title: `Infographie ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    // Étape SANS responsable (transmise « à tout le service »).
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: null, actualStart: new Date() } });
    await prisma.productionSpecs.create({ data: { manuscriptId: m.id, trimFormat: "14x21", finalPages: 200, paperInterior: "Offset 80g", paperCover: "Couché 250g", binding: "broche", spineNeedsRecalc: false } });
    await prisma.imageAsset.create({ data: { manuscriptId: m.id, type: "couverture_1", technicalOk: true, rightsOrigin: "creation_interne" } });
    await seedStepDeliverable(m.id, "INFOGRAPHIE");

    const infoCookie = await login(info.username, "Info123!");
    // La fiche doit annoncer canSelfClose = true pour cet infographe non affecté.
    const fiche = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}`, headers: { cookie: infoCookie } });
    expect(fiche.json().canSelfClose).toBe(true);

    // D-055 : l'étape suivante est désormais la Validation du BAT (contrôle qualité).
    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/INFOGRAPHIE/validate`, headers: { cookie: infoCookie }, payload: { assignee_id: cq.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("VALIDATION_BAT");
  });

  it("un infographe NON affecté ne peut pas clôturer (403)", async () => {
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const other = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const secr = await createUserWithRole(`secr_${rnd()}`, "ASSISTANT_EDITORIAL", "Secr123!");
    const m = await manuscriptAtInfographie(info.id, { converged: true });
    const otherCookie = await login(other.username, "Info123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/INFOGRAPHIE/validate`, headers: { cookie: otherCookie }, payload: { assignee_id: secr.id } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });
});
