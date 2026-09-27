import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, seedStepDeliverable } from "./helpers.js";

// CLÔTURE DE LA MISE EN PAGE (demande opérateur 27/09/2026) : le maquettiste
// affecté peut valider sa mise en page et choisir l'infographe destinataire.
// À sa clôture, le Directeur éditorial ET le Responsable production/impression
// sont notifiés. Un maquettiste non affecté ne peut pas clôturer.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("clôture de la mise en page par le maquettiste", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function login(username: string, password: string) {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
    return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  }

  async function manuscriptAtMiseEnPage(maquettisteId: string) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-MEP-${rnd()}`, title: `Maquette ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: maquettisteId, actualStart: new Date() } });
    await prisma.productionSpecs.create({ data: { manuscriptId: m.id } }); // fiche technique ouverte
    await seedStepDeliverable(m.id, "MISE_EN_PAGE"); // maquette déposée (verrou livrable)
    return m;
  }

  it("le maquettiste affecté valide et transmet à l'infographe ; DIRED + RESP production notifiés", async () => {
    const maq = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const dir = await createUserWithRole(`dir_${rnd()}`, "DIR_EDITORIAL", "Dir123!");
    const prod = await createUserWithRole(`prod_${rnd()}`, "RESP_IMPRESSION", "Prod123!");
    const maqCookie = await login(maq.username, "Maq123!");
    const m = await manuscriptAtMiseEnPage(maq.id);

    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/MISE_EN_PAGE/validate`, headers: { cookie: maqCookie }, payload: { assignee_id: info.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("INFOGRAPHIE");

    // L'ouvrage est passé en infographie, confié à l'infographe choisi.
    const infoStatus = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "INFOGRAPHIE" } });
    const fresh = await prisma.manuscript.findUniqueOrThrow({ where: { id: m.id } });
    expect(fresh.statusId).toBe(infoStatus.id);
    const nextStep = await prisma.manuscriptStep.findUnique({ where: { manuscriptId_statusId: { manuscriptId: m.id, statusId: infoStatus.id } } });
    expect(nextStep?.responsibleId).toBe(info.id);

    // Directeur éditorial ET Responsable production/impression notifiés.
    const dirNotif = await prisma.notification.count({ where: { userId: dir.id, entityId: m.id, title: { contains: "Mise en page clôturée" } } });
    const prodNotif = await prisma.notification.count({ where: { userId: prod.id, entityId: m.id, title: { contains: "Mise en page clôturée" } } });
    expect(dirNotif).toBeGreaterThan(0);
    expect(prodNotif).toBeGreaterThan(0);
  });

  it("un maquettiste NON affecté ne peut pas clôturer (403)", async () => {
    const maq = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const other = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const m = await manuscriptAtMiseEnPage(maq.id);
    const otherCookie = await login(other.username, "Maq123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/MISE_EN_PAGE/validate`, headers: { cookie: otherCookie }, payload: { assignee_id: info.id } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });
});
