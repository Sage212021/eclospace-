import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Périmètre personnel d'une étape (demande opérateur 30/09/2026) : un exécutant
// (maquettiste) ne voit, à son étape, que les ouvrages qui LUI sont confiés ou
// pas encore assignés — jamais ceux d'un collègue. Les responsables voient tout.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("liste par étape — périmètre personnel (mine)", () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function login(u: string, p: string) {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  }

  async function manuscriptAtMiseEnPage(responsibleId: string | null) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-MINE-${rnd()}`, title: `Mine ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId, actualStart: new Date() } });
    return m;
  }

  it("un maquettiste ne voit que ses ouvrages + les non assignés, pas ceux d'un collègue", async () => {
    const a = await createUserWithRole(`maqA_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const b = await createUserWithRole(`maqB_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const mineA = await manuscriptAtMiseEnPage(a.id);
    const mineB = await manuscriptAtMiseEnPage(b.id);
    const libre = await manuscriptAtMiseEnPage(null);

    const aCookie = await login(a.username, "Maq123!");
    const res = await app.inject({ method: "GET", url: "/api/v1/manuscripts?status=MISE_EN_PAGE&mine=true", headers: { cookie: aCookie } });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((m) => m.id);
    expect(ids).toContain(mineA.id);   // le sien
    expect(ids).toContain(libre.id);   // non assigné (à prendre)
    expect(ids).not.toContain(mineB.id); // celui du collègue → masqué
  });

  it("sans « mine » (responsable/direction), on voit tous les ouvrages de l'étape", async () => {
    const a = await createUserWithRole(`maqA_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const b = await createUserWithRole(`maqB_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const mineA = await manuscriptAtMiseEnPage(a.id);
    const mineB = await manuscriptAtMiseEnPage(b.id);

    const res = await app.inject({ method: "GET", url: "/api/v1/manuscripts?status=MISE_EN_PAGE", headers: { cookie: adminCookie } });
    const ids = (res.json() as { id: string }[]).map((m) => m.id);
    expect(ids).toContain(mineA.id);
    expect(ids).toContain(mineB.id);
  });
});
