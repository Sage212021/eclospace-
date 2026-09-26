import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// CLÔTURE DE LA CORRECTION (demande opérateur 26/09/2026) : le correcteur affecté
// peut clôturer lui-même sa correction et choisir le maquettiste destinataire.
// Garde-fous : texte version finale ET couverture corrigée finale exigés ; un
// correcteur non affecté ne peut pas clôturer.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("clôture de la correction par le correcteur", () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function login(username: string, password: string) {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
    return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  }

  async function manuscriptAtCorrectionWithCorrector(correctorId: string) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-CLO-${rnd()}`, title: `Clôture ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    // Le correcteur est responsable de l'étape Correction courante.
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: correctorId, actualStart: new Date() } });
    return m;
  }

  const deposit = (mId: string, phase: string) => {
    const up = multipart("file", `${phase}.txt`, `${phase} contenu`);
    return app.inject({ method: "POST", url: `/api/v1/manuscripts/${mId}/correction-cycle/${phase}`, headers: { cookie: adminCookie, ...up.headers }, payload: up.body });
  };

  it("close-info : le correcteur voit l'étape suivante, les maquettistes et les fichiers manquants", async () => {
    const corr = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Corr123!");
    const maq = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const corrCookie = await login(corr.username, "Corr123!");
    const m = await manuscriptAtCorrectionWithCorrector(corr.id);

    const info = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction/close-info`, headers: { cookie: corrCookie } });
    expect(info.statusCode).toBe(200);
    const body = info.json();
    expect(body.at_correction).toBe(true);
    expect(body.next_step.code).toBe("MISE_EN_PAGE");
    expect(body.maquettistes.some((x: { id: string }) => x.id === maq.id)).toBe(true);
    expect(body.ready).toBe(false); // rien déposé
    expect(body.cover_missing).toBe(true);
  });

  it("bloque tant que texte final + couverture finale ne sont pas déposés, puis clôture et transmet au maquettiste", async () => {
    const corr = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Corr123!");
    const maq = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const corrCookie = await login(corr.username, "Corr123!");
    const m = await manuscriptAtCorrectionWithCorrector(corr.id);

    // Texte seul (rapport + VCF) → couverture finale manquante → refus.
    expect((await deposit(m.id, "rapport_1")).statusCode).toBe(201);
    expect((await deposit(m.id, "integration_finale")).statusCode).toBe(201);
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie: corrCookie }, payload: { assignee_id: maq.id } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("correction_cycle_incomplete");
    expect(blocked.json().message).toContain("Couverture corrigée finale");

    // Couverture finale déposée → clôture possible.
    expect((await deposit(m.id, "couverture_finale")).statusCode).toBe(201);
    const ready = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction/close-info`, headers: { cookie: corrCookie } });
    expect(ready.json().ready).toBe(true);

    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie: corrCookie }, payload: { assignee_id: maq.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().advanced).toBe(true);

    // L'ouvrage est passé en mise en page, confié au maquettiste choisi.
    const mep = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const fresh = await prisma.manuscript.findUniqueOrThrow({ where: { id: m.id } });
    expect(fresh.statusId).toBe(mep.id);
    const nextStep = await prisma.manuscriptStep.findUnique({ where: { manuscriptId_statusId: { manuscriptId: m.id, statusId: mep.id } } });
    expect(nextStep?.responsibleId).toBe(maq.id);
    const notif = await prisma.notification.count({ where: { userId: maq.id, entityId: m.id } });
    expect(notif).toBeGreaterThan(0);
  });

  it("un correcteur NON affecté ne peut pas clôturer (403)", async () => {
    const corr = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Corr123!");
    const other = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Corr123!");
    const maq = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const m = await manuscriptAtCorrectionWithCorrector(corr.id);
    await deposit(m.id, "rapport_1");
    await deposit(m.id, "integration_finale");
    await deposit(m.id, "couverture_finale");

    const otherCookie = await login(other.username, "Corr123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie: otherCookie }, payload: { assignee_id: maq.id } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });
});
