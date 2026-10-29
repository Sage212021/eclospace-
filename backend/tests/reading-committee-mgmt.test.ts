import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, seedManuscriptSourceFile, seedInfographe } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Gestion du comité de lecture (demande opérateur du 29/07/2026) : anti-doublon
// d'affectation, retrait d'une mission erronée, et clôture manuelle du comité
// pour débloquer le passage à la décision éditoriale.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("comité de lecture : doublon, retrait, clôture", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let reader2Id: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    const reader2 = await createUserWithRole(`reader2_${rnd()}`, "CORRECTEUR", "Reader123!");
    reader2Id = reader2.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createManuscriptAtCommittee(title: string) {
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/manuscripts",
        headers: { cookie: adminCookie },
        payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais", author: { first_name: "Auteur", last_name: title, email: "auteur@example.com", id_type: "CNI", id_number: "100200300" } },
      })
    ).json();
    await seedManuscriptSourceFile(created.id);
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${created.id}/steps/VERIF_ADMIN/validate`, headers: { cookie: adminCookie }, payload: { infographe_id: await seedInfographe() } });
    return created;
  }

  async function statusCode(manuscriptId: string) {
    const m = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscriptId }, include: { status: true } });
    return m.status.code;
  }

  it("candidats à la lecture : uniquement les rôles éditoriaux habilités (pas les autres pôles)", async () => {
    // reader2 (CORRECTEUR) est habilité ; un magasinier ne l'est pas.
    const magU = `mag_${rnd()}`;
    const mag = await createUserWithRole(magU, "MAGASINIER", "Passw0rd!");
    const res = await app.inject({ method: "GET", url: "/api/v1/reading-candidates", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(reader2Id); // CORRECTEUR habilité
    expect(ids).not.toContain(mag.id); // MAGASINIER exclu
  });

  it("relecteur externe : compte dédié créé, listé comme candidat externe, et capable de se connecter", async () => {
    const username = `ext_${rnd()}`;
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/reading-candidates/external",
      headers: { cookie: adminCookie },
      payload: { username, email: `${username}@externe.test`, password: "Passw0rd!" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().external).toBe(true);

    // Apparaît dans les candidats, marqué externe.
    const cand = await app.inject({ method: "GET", url: "/api/v1/reading-candidates", headers: { cookie: adminCookie } });
    const row = (cand.json() as { id: string; username: string; external: boolean }[]).find((u) => u.username === username);
    expect(row).toBeTruthy();
    expect(row!.external).toBe(true);

    // Le compte est bien externe (espace relecteur) et peut se connecter.
    const account = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(account.accountType).toBe("external");
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "Passw0rd!" } });
    expect(login.statusCode).toBe(200);
  });

  it("refuse d'affecter deux fois le même relecteur (anti-doublon)", async () => {
    const m = await createManuscriptAtCommittee(`Doublon ${rnd()}`);
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: reader2Id, due_at: "2026-12-31T00:00:00.000Z" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: reader2Id, due_at: "2026-12-31T00:00:00.000Z" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("reader_already_assigned");
  });

  it("retire une mission erronée (annulation)", async () => {
    const m = await createManuscriptAtCommittee(`Retrait ${rnd()}`);
    const a = (
      await app.inject({
        method: "POST",
        url: `/api/v1/manuscripts/${m.id}/reading-assignments`,
        headers: { cookie: adminCookie },
        payload: { reader_id: reader2Id, due_at: "2026-12-31T00:00:00.000Z" },
      })
    ).json();
    const cancel = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${a.id}/cancel`, headers: { cookie: adminCookie } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().advanced).toBe(false);
    const refreshed = await prisma.readingAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(refreshed.status).toBe("cancelled");
    // Le manuscrit reste au comité (aucun rapport remis).
    expect(await statusCode(m.id)).toBe("COMITE_LECTURE");
  });

  it("revient à l'étape précédente (correction d'une validation faite par erreur)", async () => {
    const m = await createManuscriptAtCommittee(`Retour ${rnd()}`);
    expect(await statusCode(m.id)).toBe("COMITE_LECTURE");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/steps/revert`,
      headers: { cookie: adminCookie },
      payload: { reason: "validation par erreur" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("VERIF_ADMIN");
    expect(await statusCode(m.id)).toBe("VERIF_ADMIN");

    // L'étape précédente (VERIF_ADMIN) est rouverte : sa validation est effacée.
    const verif = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "VERIF_ADMIN" } });
    const step = await prisma.manuscriptStep.findFirst({ where: { manuscriptId: m.id, statusId: verif.id } });
    if (step) expect(step.validatedAt).toBeNull();
  });

  it("clôt le comité manuellement et transmet à la décision éditoriale", async () => {
    const m = await createManuscriptAtCommittee(`Cloture ${rnd()}`);
    // admin (relecteur) + reader2 (ne rendra pas).
    const adminAssign = (
      await app.inject({
        method: "POST",
        url: `/api/v1/manuscripts/${m.id}/reading-assignments`,
        headers: { cookie: adminCookie },
        payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: reader2Id, due_at: "2026-12-31T00:00:00.000Z" },
    });

    // Clôture sans aucun rapport → refusée.
    const tooEarly = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/close-reading-committee`, headers: { cookie: adminCookie } });
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json().code).toBe("no_evaluation");

    // admin remet son évaluation ; reader2 reste en attente → pas d'avance auto.
    const criteria = await prisma.evaluationCriterion.findMany({ where: { isActive: true } });
    await app.inject({
      method: "POST",
      url: `/api/v1/reading-assignments/${adminAssign.id}/evaluation`,
      headers: { cookie: adminCookie },
      payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 8 })), recommendation: "accept" },
    });
    expect(await statusCode(m.id)).toBe("COMITE_LECTURE");

    // Clôture manuelle : annule reader2 et transmet à la décision.
    const close = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/close-reading-committee`, headers: { cookie: adminCookie } });
    expect(close.statusCode).toBe(200);
    expect(close.json().advanced).toBe(true);
    expect(await statusCode(m.id)).toBe("DECISION_EDITORIALE");
  });
});
