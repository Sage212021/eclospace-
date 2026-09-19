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
  let adminId: string;
  let infographId: string;
  let manuscriptId: string;
  const s = rnd();

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const infograph = await createUserWithRole(`infocov_${s}`, "RESP_INFOGRAPHIE", "Info1!pass");
    infographId = infograph.id;
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-COV-${s}`, title: `Couv ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    const info = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "INFOGRAPHIE" } });
    await prisma.manuscriptStep.create({ data: { manuscriptId, statusId: info.id, responsibleId: infographId } });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.documentVersion.deleteMany({ where: { document: { entityId: manuscriptId } } }).catch(() => {});
    await prisma.document.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { userId: infographId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: infographId } }).catch(() => {});
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

  it("un rapport de couverture ne bloque pas le passage de l'étape correction (optionnel)", async () => {
    // Les phases couverture sont facultatives : elles ne figurent pas parmi les
    // phases obligatoires du cycle texte.
    const text = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle`, headers: { cookie } })).json() as Array<{ key: string; required: boolean }>;
    expect(text.every((p) => !p.key.startsWith("couverture"))).toBe(true);
  });
});
