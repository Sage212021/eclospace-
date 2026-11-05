import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

function multipart(fieldName: string, filename: string, contentType: string, content: Buffer) {
  const boundary = `----eclos${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

// Chaque DÉPÔT dans le cycle de correction (rapport BAT1/BAT2, version intégrée,
// VCF) doit déclencher une NOTIFICATION au bon destinataire, portant le LIBELLÉ
// de ce qui a été transmis (cloche + bande temps réel + push téléphone, via
// notifyUsers). On vérifie ici la création de la notification et son libellé.

const PWD = "Depo123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

async function deposit(app: FastifyInstance, cookie: string, manuscriptId: string, phase: string, content: string) {
  const mp = multipart("file", `${phase}.txt`, "text/plain", Buffer.from(content));
  return app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/${phase}`, headers: { cookie, "content-type": mp.contentType }, payload: mp.body });
}

describe("Notification à chaque dépôt du cycle de correction", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let manuscriptId: string;
  let correcteurId: string;
  let integrateurId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const correcteur = await createUserWithRole(`corr_dep_${rnd()}`, "CORRECTEUR", PWD);
    const integrateur = await createUserWithRole(`integ_dep_${rnd()}`, "DIR_EDITORIAL", PWD);
    correcteurId = correcteur.id;
    integrateurId = integrateur.id;
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `DEP-${rnd()}`, title: `Dépôt notif ${rnd()}`, language: "fr", statusId: status.id, ownerId: admin.id, receivedAt: new Date(), createdBy: admin.id, updatedBy: admin.id, correctionIntegratorId: integrateur.id },
    });
    manuscriptId = m.id;
    // Correcteur = responsable de l'étape Correction.
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: correcteur.id } });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityId: manuscriptId } }).catch(() => {});
    await prisma.documentVersion.deleteMany({ where: { document: { entityId: manuscriptId } } }).catch(() => {});
    await prisma.document.deleteMany({ where: { entityId: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("le dépôt de la 1re correction notifie l'intégrateur, avec le libellé transmis", async () => {
    const r = await deposit(app, adminCookie, manuscriptId, "rapport_1", "1re correction");
    expect(r.statusCode).toBe(201);
    const notifs = await prisma.notification.findMany({ where: { userId: integrateurId, entityId: manuscriptId } });
    expect(notifs.length).toBeGreaterThan(0);
    const n = notifs[notifs.length - 1];
    expect(`${n.title} ${n.body}`).toContain("1re correction");
    expect(n.body).toContain("Nouveau dépôt");
  });

  it("le dépôt de la version corrigée finale (VCF) notifie le correcteur — plus de dépôt silencieux", async () => {
    // Pré-requis d'ordre : version intégrée puis 2e relecture avant la VCF.
    expect((await deposit(app, adminCookie, manuscriptId, "integration_1", "version intégrée")).statusCode).toBe(201);
    expect((await deposit(app, adminCookie, manuscriptId, "relecture_2", "2e relecture")).statusCode).toBe(201);
    const vcf = await deposit(app, adminCookie, manuscriptId, "integration_finale", "VCF");
    expect(vcf.statusCode).toBe(201);

    const notifs = await prisma.notification.findMany({ where: { userId: correcteurId, entityId: manuscriptId } });
    const finale = notifs.find((n) => `${n.title} ${n.body}`.includes("Version corrigée finale"));
    expect(finale).toBeTruthy();
  });
});
