import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Affectation nominative d'étape (demande opérateur 20/08/2026) : l'étape qui
// transmet peut confier le dossier à UNE personne précise du service suivant
// (correcteur, maquettiste, infographe…) — comme le comité de lecture confie une
// lecture. La personne désignée est notifiée seule et devient responsable.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function manuscriptAt(code: string) {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-AFF-${rnd()}`, title: `Affectation ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

describe("affectation nominative de l'étape suivante", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let correcteurId: string;
  let magasinierId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    correcteurId = (await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Corr123!")).id;
    magasinierId = (await createUserWithRole(`mag_${rnd()}`, "MAGASINIER", "Mag123!")).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste les candidats du service suivant (correcteurs pour la correction)", async () => {
    const m = await manuscriptAt("PLANIFICATION"); // suivant = CORRECTION (service CORR)
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/next-assignees`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().next_step.code).toBe("CORRECTION");
    const ids = (res.json().assignees as { id: string }[]).map((a) => a.id);
    expect(ids).toContain(correcteurId);
    expect(ids).not.toContain(magasinierId); // le magasinier n'est pas du service correction
  });

  it("confie le dossier à une personne : elle seule est notifiée et devient responsable", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    const before = await prisma.notification.count({ where: { userId: correcteurId, entityId: m.id } });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`,
      headers: { cookie: adminCookie },
      payload: { assignee_id: correcteurId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("CORRECTION");

    // Notification personnelle « Dossier confié ».
    const notif = await prisma.notification.findFirst({ where: { userId: correcteurId, entityId: m.id }, orderBy: { createdAt: "desc" } });
    expect(notif).toBeTruthy();
    expect(notif!.title).toContain("Dossier confié");
    expect(await prisma.notification.count({ where: { userId: correcteurId, entityId: m.id } })).toBe(before + 1);

    // Le correcteur devient responsable de l'étape Correction.
    const correction = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const step = await prisma.manuscriptStep.findUnique({ where: { manuscriptId_statusId: { manuscriptId: m.id, statusId: correction.id } } });
    expect(step?.responsibleId).toBe(correcteurId);
  });

  it("refuse une personne étrangère au service suivant (400)", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`,
      headers: { cookie: adminCookie },
      payload: { assignee_id: magasinierId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_assignee");
    // Le manuscrit n'a pas avancé.
    const still = await prisma.manuscript.findUniqueOrThrow({ where: { id: m.id }, include: { status: true } });
    expect(still.status.code).toBe("PLANIFICATION");
  });

  it("« Mes dossiers à traiter » liste les manuscrits confiés à l'utilisateur connecté", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: (await prisma.user.findUniqueOrThrow({ where: { id: correcteurId } })).username, password: "Corr123!" } });
    const corrCookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));

    const m = await manuscriptAt("PLANIFICATION");
    // Avant affectation : absent de mes dossiers.
    const before = await app.inject({ method: "GET", url: "/api/v1/my-dossiers", headers: { cookie: corrCookie } });
    expect((before.json() as { manuscript_id: string }[]).some((d) => d.manuscript_id === m.id)).toBe(false);

    // On confie le dossier au correcteur.
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie: adminCookie }, payload: { assignee_id: correcteurId } });

    const after = await app.inject({ method: "GET", url: "/api/v1/my-dossiers", headers: { cookie: corrCookie } });
    expect(after.statusCode).toBe(200);
    const mine = (after.json() as { manuscript_id: string; step_code: string }[]).find((d) => d.manuscript_id === m.id);
    expect(mine).toBeTruthy();
    expect(mine!.step_code).toBe("CORRECTION");
  });

  it("sans désignation, l'affectation reste facultative (le service est notifié)", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("CORRECTION");
    // Le service correction (dont le correcteur) est notifié « Nouveau dossier ».
    const notif = await prisma.notification.findFirst({ where: { userId: correcteurId, entityId: m.id } });
    expect(notif).toBeTruthy();
    expect(notif!.title).toBe("Nouveau dossier à traiter");
  });
});
