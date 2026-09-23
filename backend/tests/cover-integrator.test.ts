import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Désignation de l'INFOGRAPHE pour la correction de couverture (rubrique
// « correction de couverture ») : c'est lui qui reçoit le rapport de couverture.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("Infographe désigné pour la correction de couverture", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let infographId: string;
  let correcteurId: string;
  let manuscriptId: string;
  const s = rnd();

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    infographId = (await createUserWithRole(`cov_info_${s}`, "RESP_INFOGRAPHIE", "Info1!pass")).id;
    correcteurId = (await createUserWithRole(`cov_corr_${s}`, "CORRECTEUR", "Corr1!pass")).id;
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-COVI-${s}`, title: `CovInteg ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.documentVersion.deleteMany({ where: { document: { entityId: manuscriptId } } }).catch(() => {});
    await prisma.document.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { userId: { in: [infographId, correcteurId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [infographId, correcteurId] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse un non-infographe comme intégrateur de couverture", async () => {
    const r = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${manuscriptId}/cover-integrator`, headers: { cookie }, payload: { user_id: correcteurId } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("invalid_integrator");
  });

  it("désigne l'infographe et l'expose ; il figure dans la liste des candidats", async () => {
    const set = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${manuscriptId}/cover-integrator`, headers: { cookie }, payload: { user_id: infographId } });
    expect(set.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/cover-integrator`, headers: { cookie } });
    expect(get.json().integrator?.id).toBe(infographId);
    const list = (await app.inject({ method: "GET", url: "/api/v1/cover-integrators", headers: { cookie } })).json() as Array<{ id: string }>;
    expect(list.some((u) => u.id === infographId)).toBe(true);
  });

  it("le rapport de couverture notifie l'infographe DÉSIGNÉ", async () => {
    // (l'infographe a été désigné au test précédent)
    const mp = multipart("rapport-couv.txt", "Rapport couverture.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/couverture_1`, headers: { cookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    const notif = await prisma.notification.findFirst({ where: { userId: infographId, entityType: "manuscript", entityId: manuscriptId, title: { contains: "couverture" } } });
    expect(notif).toBeTruthy();
  });
});
