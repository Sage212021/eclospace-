import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("secrétariat éditorial, comité de lecture, décision éditoriale (Lot 1)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createManuscript(title: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Auteur", last_name: "Test" },
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it("génère un numéro de manuscrit et valide automatiquement l'étape 1 (réception)", async () => {
    const manuscript = await createManuscript("Manuscrit A");
    expect(manuscript.manuscriptNumber).toMatch(/^MS-\d{4}-\d{4}$/);

    const timeline = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts/${manuscript.id}/timeline`,
      headers: { cookie: adminCookie },
    });
    const steps = timeline.json();
    expect(steps[0].status_code).toBe("RECEPTION");
    expect(steps[0].validated_at).not.toBeNull();
    expect(steps[1].status_code).toBe("VERIF_ADMIN");
    expect(steps[1].validated_at).toBeNull();
  });

  it("interdit de sauter une étape ou de valider hors séquence", async () => {
    const manuscript = await createManuscript("Manuscrit B");

    const skipToComite = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/COMITE_LECTURE/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(skipToComite.statusCode).toBe(409);
    expect(skipToComite.json().code).toBe("dedicated_flow_required");

    const wrongOrder = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/CORRECTION/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(wrongOrder.statusCode).toBe(409);
    expect(wrongOrder.json().code).toBe("step_out_of_order");
  });

  it("un rôle sans permission manuscripts:saisie ne peut pas créer de manuscrit", async () => {
    await createUserWithRole("correcteur_manuscripts_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_manuscripts_test", "Correcteur123!");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie },
      payload: { title: "X", genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "A", last_name: "B" } },
    });
    expect(response.statusCode).toBe(403);
  });

  it("calcule le score pondéré et transmet automatiquement à la Direction éditoriale quand tous les rapports sont remis", async () => {
    const manuscript = await createManuscript("Manuscrit C");

    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/VERIF_ADMIN/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });

    const assignResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" },
    });
    expect(assignResponse.statusCode).toBe(201);
    const assignment = assignResponse.json();

    const criteria = await prisma.evaluationCriterion.findMany();
    const ligneEditoriale = criteria.find((c) => c.label.startsWith("Adéquation"))!;
    // Note maximale sur le critère le plus fortement pondéré (×3), notes
    // basses ailleurs : le score global doit être tiré vers le haut par la
    // pondération, pas être une simple moyenne arithmétique.
    const scores = criteria.map((c) => ({
      criterion_id: c.id,
      score: c.id === ligneEditoriale.id ? 10 : 2,
    }));

    const evalResponse = await app.inject({
      method: "POST",
      url: `/api/v1/reading-assignments/${assignment.id}/evaluation`,
      headers: { cookie: adminCookie },
      payload: { scores, recommendation: "accept" },
    });
    expect(evalResponse.statusCode).toBe(201);
    const evaluation = evalResponse.json();

    const totalCoefficient = criteria.reduce((sum, c) => sum + Number(c.coefficient), 0);
    const expectedScore = (10 * Number(ligneEditoriale.coefficient) + 2 * (totalCoefficient - Number(ligneEditoriale.coefficient))) / totalCoefficient;
    // Précision limitée à 1 décimale : le champ est stocké en Decimal(6,2) côté base.
    expect(Number(evaluation.globalScore)).toBeCloseTo(expectedScore, 1);
    // La moyenne arithmétique simple (sans pondération) donnerait une valeur différente.
    const simpleAverage = criteria.reduce((sum, c) => sum + (c.id === ligneEditoriale.id ? 10 : 2), 0) / criteria.length;
    expect(Number(evaluation.globalScore)).not.toBeCloseTo(simpleAverage, 1);

    const timeline = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts/${manuscript.id}/timeline`,
      headers: { cookie: adminCookie },
    });
    const steps = timeline.json();
    const comite = steps.find((s: { status_code: string }) => s.status_code === "COMITE_LECTURE");
    expect(comite.validated_at).not.toBeNull();
  });

  it("un refus clôt le workflow directement vers l'archivage (Ch. 4 §4.3)", async () => {
    const manuscript = await createManuscript("Manuscrit D");
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/VERIF_ADMIN/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    const assignResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" },
    });
    const assignment = assignResponse.json();
    const criteria = await prisma.evaluationCriterion.findMany();
    await app.inject({
      method: "POST",
      url: `/api/v1/reading-assignments/${assignment.id}/evaluation`,
      headers: { cookie: adminCookie },
      payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 1 })), recommendation: "reject" },
    });

    const decision = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/editorial-decision`,
      headers: { cookie: adminCookie },
      payload: { decision: "refus", motivation: "Hors ligne éditoriale." },
    });
    expect(decision.statusCode).toBe(201);

    const detail = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}`, headers: { cookie: adminCookie } });
    expect(detail.json().status.code).toBe("ARCHIVAGE");
  });
});
