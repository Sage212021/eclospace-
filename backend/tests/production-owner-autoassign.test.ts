import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// « Même agent sur toute la production » (demande opérateur 03/10) : l'infographe
// désigné à l'intégration couverture (coverIntegratorId) est auto-affecté comme
// responsable des étapes graphiques suivantes (jusqu'à l'attribution des
// références), sans affectation manuelle.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("propriétaire de production auto-affecté", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("valider la mise en page auto-affecte l'infographe propriétaire à l'infographie", async () => {
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Pwd123!");
    const mep = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-OWN-${rnd()}`, title: `Owner ${rnd()}`, statusId: mep.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date(), coverIntegratorId: info.id },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: mep.id, responsibleId: adminId, actualStart: new Date() } });
    // Pré-requis mise en page : une fiche technique doit exister.
    await prisma.productionSpecs.create({ data: { manuscriptId: m.id } });

    const val = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/MISE_EN_PAGE/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(val.statusCode).toBe(200);

    // L'étape INFOGRAPHIE (suivante) doit être confiée automatiquement à l'infographe.
    const infographie = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "INFOGRAPHIE" } });
    const step = await prisma.manuscriptStep.findFirst({ where: { manuscriptId: m.id, statusId: infographie.id } });
    expect(step?.responsibleId).toBe(info.id);
  });

  it("sans propriétaire désigné, pas d'auto-affectation (comportement inchangé)", async () => {
    const mep = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-OWN-${rnd()}`, title: `Sans owner ${rnd()}`, statusId: mep.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: mep.id, responsibleId: adminId, actualStart: new Date() } });
    await prisma.productionSpecs.create({ data: { manuscriptId: m.id } });

    const val = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/MISE_EN_PAGE/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(val.statusCode).toBe(200);
    const infographie = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "INFOGRAPHIE" } });
    const step = await prisma.manuscriptStep.findFirst({ where: { manuscriptId: m.id, statusId: infographie.id } });
    expect(step?.responsibleId ?? null).toBeNull();
  });
});
