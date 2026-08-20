import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Correction éditoriale en deux temps : rapport de correction → intégration →
// 2e relecture → intégration finale. On ne valide pas l'étape tant que le
// rapport ET la version finale intégrée ne sont pas déposés.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

async function manuscriptAtCorrection() {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-COR-${rnd()}`, title: `Correction ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

describe("correction éditoriale en deux temps", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("les 4 phases sont proposées, vides au départ", async () => {
    const m = await manuscriptAtCorrection();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-cycle`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const phases = res.json() as { key: string; required: boolean; has_file: boolean }[];
    expect(phases.map((p) => p.key)).toEqual(["rapport_1", "integration_1", "relecture_2", "integration_finale"]);
    expect(phases.filter((p) => p.required).map((p) => p.key)).toEqual(["rapport_1", "integration_finale"]);
    expect(phases.every((p) => !p.has_file)).toBe(true);
  });

  it("bloque la validation tant que rapport + version finale intégrée manquent, puis autorise", async () => {
    const m = await manuscriptAtCorrection();

    // Rien déposé → refus.
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("correction_cycle_incomplete");
    expect(blocked.json().message).toContain("Rapport de correction");

    // Dépôt du rapport seul → toujours refusé (version finale manquante).
    const up1 = multipart("file", "rapport.txt", "Rapport de correction.");
    const r1 = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...up1.headers }, payload: up1.body });
    expect(r1.statusCode).toBe(201);
    const stillBlocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(stillBlocked.statusCode).toBe(409);
    expect(stillBlocked.json().message).toContain("Version finale intégrée");

    // Dépôt de la version finale intégrée → validation possible.
    const up2 = multipart("file", "final.txt", "Version finale intégrée.");
    const r2 = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/integration_finale`, headers: { cookie, ...up2.headers }, payload: up2.body });
    expect(r2.statusCode).toBe(201);

    const meta = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-cycle`, headers: { cookie } });
    const byKey = Object.fromEntries((meta.json() as { key: string; has_file: boolean }[]).map((p) => [p.key, p.has_file]));
    expect(byKey.rapport_1).toBe(true);
    expect(byKey.integration_finale).toBe(true);

    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().advanced).toBe(true);
  });

  it("refuse une phase inconnue (400)", async () => {
    const m = await manuscriptAtCorrection();
    const up = multipart("file", "x.txt", "y");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/phase_bidon`, headers: { cookie, ...up.headers }, payload: up.body });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_phase");
  });
});
