import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// DOSSIER CONFIÉ À UN COLLÈGUE (demande opérateur 30/09/2026) : un responsable
// (production:administration) VOIT tout mais ne doit pas modifier sans « prendre
// le dossier » — motif obligatoire, tracé au journal, collègue notifié. Un
// exécutant non habilité ne peut pas reprendre. La GET fiche expose les drapeaux
// currentAssignee / assignedToMe / canTakeOver qui pilotent le verrou consultation.

const rnd = () => Math.random().toString(36).slice(2, 7);

describe("reprise d'un dossier confié à un collègue", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function login(u: string, p: string) {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  }

  async function manuscriptAtMiseEnPage(responsibleId: string) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-TO-${rnd()}`, title: `Reprise ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId, actualStart: new Date() } });
    return m;
  }

  it("un responsable (production:administration) reprend le dossier : 200, responsable changé, journal + notification", async () => {
    const maquettiste = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const resp = await createUserWithRole(`resp_${rnd()}`, "RESP_INFOGRAPHIE", "Resp123!");
    const m = await manuscriptAtMiseEnPage(maquettiste.id);
    const respCookie = await login(resp.username, "Resp123!");

    // La fiche montre le dossier comme confié à autrui, avec droit de reprise.
    const fiche = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}`, headers: { cookie: respCookie } });
    expect(fiche.statusCode).toBe(200);
    expect(fiche.json().currentAssignee?.id).toBe(maquettiste.id);
    expect(fiche.json().assignedToMe).toBe(false);
    expect(fiche.json().canTakeOver).toBe(true);

    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/step/take-over`, headers: { cookie: respCookie }, payload: { motif: "Maquettiste absent, échéance imprimeur." } });
    expect(res.statusCode).toBe(200);

    const step = await prisma.manuscriptStep.findFirstOrThrow({ where: { manuscriptId: m.id, statusId: m.statusId } });
    expect(step.responsibleId).toBe(resp.id);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: "manuscript_step", entityId: m.id }, orderBy: { occurredAt: "desc" } });
    expect(audit).not.toBeNull();
    expect((audit!.newValues as { take_over?: boolean; motif?: string }).take_over).toBe(true);

    const notif = await prisma.notification.findFirst({ where: { userId: maquettiste.id, entityId: m.id }, orderBy: { createdAt: "desc" } });
    expect(notif).not.toBeNull();
  });

  it("un motif trop court est refusé (400)", async () => {
    const maquettiste = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const resp = await createUserWithRole(`resp_${rnd()}`, "RESP_INFOGRAPHIE", "Resp123!");
    const m = await manuscriptAtMiseEnPage(maquettiste.id);
    const respCookie = await login(resp.username, "Resp123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/step/take-over`, headers: { cookie: respCookie }, payload: { motif: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("motif_required");
  });

  it("un exécutant non habilité ne peut pas reprendre (403)", async () => {
    const maquettiste = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const autre = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const m = await manuscriptAtMiseEnPage(maquettiste.id);
    const autreCookie = await login(autre.username, "Maq123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/step/take-over`, headers: { cookie: autreCookie }, payload: { motif: "Je veux le reprendre." } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });

  it("reprendre son propre dossier est refusé (409)", async () => {
    const resp = await createUserWithRole(`resp_${rnd()}`, "RESP_INFOGRAPHIE", "Resp123!");
    const m = await manuscriptAtMiseEnPage(resp.id);
    const respCookie = await login(resp.username, "Resp123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/step/take-over`, headers: { cookie: respCookie }, payload: { motif: "Déjà à moi normalement." } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("already_mine");
  });
});
