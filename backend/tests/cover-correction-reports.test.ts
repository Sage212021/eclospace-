import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Rapports de correction de COUVERTURE : déposés dans le cycle de correction
// (branche parallèle du texte), routés à l'infographe qui les exploite.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("Rapports de correction de couverture (branche infographe)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let infoCookie: string;
  let otherInfoCookie: string;
  let adminId: string;
  let infographId: string;
  let otherInfographId: string;
  let correcteurId: string;
  let manuscriptId: string;
  const s = rnd();

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const infograph = await createUserWithRole(`infocov_${s}`, "RESP_INFOGRAPHIE", "Info1!pass");
    infographId = infograph.id;
    const otherInfo = await createUserWithRole(`infocov2_${s}`, "RESP_INFOGRAPHIE", "Info1!pass");
    otherInfographId = otherInfo.id;
    const correcteur = await createUserWithRole(`corrcov_${s}`, "CORRECTEUR", "Corr1!pass");
    correcteurId = correcteur.id;
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-COV-${s}`, title: `Couv ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    const info = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "INFOGRAPHIE" } });
    await prisma.manuscriptStep.create({ data: { manuscriptId, statusId: info.id, responsibleId: infographId } });
    // Étape CORRECTION en cours (correcteur responsable) : cible des retours de l'infographe.
    await prisma.manuscriptStep.create({ data: { manuscriptId, statusId: st.id, responsibleId: correcteurId } });

    const li = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: `infocov_${s}`, password: "Info1!pass" } });
    infoCookie = extractSessionCookie(li.cookies.map((c) => `${c.name}=${c.value}`));
    const lo = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: `infocov2_${s}`, password: "Info1!pass" } });
    otherInfoCookie = extractSessionCookie(lo.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.documentVersion.deleteMany({ where: { document: { entityId: manuscriptId } } }).catch(() => {});
    await prisma.document.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { userId: { in: [infographId, otherInfographId, correcteurId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [infographId, otherInfographId, correcteurId] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("dépose un rapport de couverture → visible dans le cycle couverture, absent du cycle texte, et notifie l'infographe", async () => {
    const mp = multipart("rapport-couverture.txt", "Rapport de correction couverture.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/couverture_1`, headers: { cookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);

    // Présent dans le cycle COUVERTURE.
    const cover = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/cover-correction-cycle`, headers: { cookie } })).json() as Array<{ key: string; has_file: boolean }>;
    expect(cover.find((p) => p.key === "couverture_1")?.has_file).toBe(true);

    // Absent du cycle TEXTE (branche parallèle, aucun mélange).
    const text = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle`, headers: { cookie } })).json() as Array<{ key: string }>;
    expect(text.some((p) => p.key === "couverture_1")).toBe(false);

    // L'infographe a été notifié.
    const notif = await prisma.notification.findFirst({ where: { userId: infographId, entityType: "manuscript", entityId: manuscriptId } });
    expect(notif).toBeTruthy();
  });

  it("les phases couverture forment un cycle séparé du texte (branche parallèle)", async () => {
    // La couverture est un cycle à part : ses phases n'apparaissent jamais dans
    // le cycle TEXTE (même si, depuis le 10/10, elles sont elles aussi obligatoires
    // pour clôturer l'étape Correction, via leur propre cycle).
    const text = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle`, headers: { cookie } })).json() as Array<{ key: string; required: boolean }>;
    expect(text.every((p) => !p.key.startsWith("couverture"))).toBe(true);
  });

  it("l'infographe désigné dépose son RETOUR d'intégration (couverture BAT2) → visible et notifie le correcteur", async () => {
    const mp = multipart("couverture-integree.txt", "Couverture intégrée BAT2.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/couverture_integration_1`, headers: { cookie: infoCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);

    const cover = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/cover-correction-cycle`, headers: { cookie } })).json() as Array<{ key: string; has_file: boolean }>;
    expect(cover.find((p) => p.key === "couverture_integration_1")?.has_file).toBe(true);

    // Le correcteur (responsable de l'étape CORRECTION) est notifié du retour.
    const notif = await prisma.notification.findFirst({ where: { userId: correcteurId, entityType: "manuscript", entityId: manuscriptId } });
    expect(notif).toBeTruthy();
  });

  it("un infographe NON désigné ne peut pas déposer le retour d'intégration (403)", async () => {
    const mp = multipart("pirate.txt", "Tentative.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/couverture_finale`, headers: { cookie: otherInfoCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(403);
    expect(up.json().code).toBe("not_authorized_for_phase");
  });

  it("un infographe ne peut pas déposer un RAPPORT de correction (réservé au correcteur) — 403", async () => {
    const mp = multipart("rapport.txt", "Tentative rapport.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/couverture_1`, headers: { cookie: infoCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(403);
    expect(up.json().code).toBe("not_authorized_for_phase");
  });
});
