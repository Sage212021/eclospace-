import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
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
        payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } },
      })
    ).json();
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${created.id}/steps/VERIF_ADMIN/validate`, headers: { cookie: adminCookie }, payload: {} });
    return created;
  }

  async function statusCode(manuscriptId: string) {
    const m = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscriptId }, include: { status: true } });
    return m.status.code;
  }

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
