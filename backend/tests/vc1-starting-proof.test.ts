import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// « Version à corriger » (VC1) déposée à la Décision éditoriale : fichier
// manuscrit + textes de couverture (1ère/dos/4ème), matière de la correction.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

async function manuscriptAtDecision() {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "DECISION_EDITORIALE" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-VC1-${rnd()}`, title: `Décision ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

describe("Version à corriger (VC1) — dépôt à la Décision éditoriale", () => {
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

  it("propose les 4 emplacements, vides au départ", async () => {
    const m = await manuscriptAtDecision();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/vc1`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const slots = res.json() as { key: string; has_file: boolean }[];
    expect(slots.map((s) => s.key)).toEqual(["manuscrit", "couv_1", "couv_dos", "couv_4"]);
    expect(slots.every((s) => !s.has_file)).toBe(true);
  });

  it("dépose le manuscrit et une couverture, puis les liste comme présents", async () => {
    const m = await manuscriptAtDecision();
    const up1 = multipart("file", "manuscrit.txt", "Texte à corriger");
    const r1 = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/vc1/manuscrit`, headers: { cookie, ...up1.headers }, payload: up1.body });
    expect(r1.statusCode).toBe(201);
    const up2 = multipart("file", "couv1.txt", "1ère de couverture");
    const r2 = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/vc1/couv_1`, headers: { cookie, ...up2.headers }, payload: up2.body });
    expect(r2.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/vc1`, headers: { cookie } });
    const byKey = Object.fromEntries((res.json() as { key: string; has_file: boolean }[]).map((s) => [s.key, s.has_file]));
    expect(byKey.manuscrit).toBe(true);
    expect(byKey.couv_1).toBe(true);
    expect(byKey.couv_dos).toBe(false);
  });

  it("refuse un emplacement inconnu (400)", async () => {
    const m = await manuscriptAtDecision();
    const up = multipart("file", "x.txt", "y");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/vc1/slot_bidon`, headers: { cookie, ...up.headers }, payload: up.body });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_slot");
  });
});
