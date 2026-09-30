import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// CLÔTURE DE L'ATTRIBUTION DES RÉFÉRENCES (demande opérateur 30/09/2026) : même
// principe — le secrétaire affecté peut clôturer l'étape ISBN/dépôt légal et
// transmettre à la suite. Un non-affecté ne peut pas. La complétude ISBN reste
// exigée (le contrôle de permission passe AVANT ce blocage métier).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("clôture de l'attribution des références par le secrétariat", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function login(u: string, p: string) {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  }

  async function manuscriptAtReferences(responsibleId: string) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "ATTRIBUTION_REFERENCES" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-REF-${rnd()}`, title: `Références ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId, actualStart: new Date() } });
    return m;
  }

  it("le secrétaire affecté passe le contrôle de permission (409 complétude ISBN, pas 403)", async () => {
    const secr = await createUserWithRole(`secr_${rnd()}`, "ASSISTANT_EDITORIAL", "Secr123!");
    const secrCookie = await login(secr.username, "Secr123!");
    const m = await manuscriptAtReferences(secr.id);
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/ATTRIBUTION_REFERENCES/validate`, headers: { cookie: secrCookie }, payload: {} });
    expect(res.statusCode).toBe(409); // bloqué par la complétude ISBN, PAS par la permission (403)
    expect(res.json().code).toBe("isbn_completeness_incomplete");
  });

  it("un secrétaire NON affecté ne peut pas clôturer (403)", async () => {
    const secr = await createUserWithRole(`secr_${rnd()}`, "ASSISTANT_EDITORIAL", "Secr123!");
    const other = await createUserWithRole(`secr_${rnd()}`, "ASSISTANT_EDITORIAL", "Secr123!");
    const m = await manuscriptAtReferences(secr.id);
    const otherCookie = await login(other.username, "Secr123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/ATTRIBUTION_REFERENCES/validate`, headers: { cookie: otherCookie }, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });
});
