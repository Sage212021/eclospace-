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

  // Phase 2 — Dates & antidatage (spéc. fonctionnelle §8)
  it("importe un ouvrage déjà paru avec sa date de parution historique, hors circuit de production", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts/import",
      headers: { cookie: adminCookie },
      payload: {
        title: "Ouvrage historique",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Ancien", last_name: "Auteur" },
        publication_date: "2019-05-10",
      },
    });
    expect(res.statusCode).toBe(201);
    const imported = res.json();
    expect(imported.isBackCatalogue).toBe(true);
    expect(imported.publicationDate.slice(0, 10)).toBe("2019-05-10");

    // Entré directement au suivi post-publication (pas à l'étape 1).
    const detail = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${imported.id}`, headers: { cookie: adminCookie } });
    expect(detail.json().status.code).toBe("SUIVI_POST_PUBLICATION");

    // Traçabilité (§9) : le journal conserve la date historique ET marque l'antidatage.
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "manuscript", entityId: imported.id, action: "create" },
      orderBy: { occurredAt: "desc" },
    });
    const values = audit?.newValues as Record<string, unknown> | null;
    expect(values?.imported).toBe(true);
    expect(values?.antidated).toBe(true);
    expect(values?.publication_date).toContain("2019-05-10");
    expect(typeof values?.recorded_at).toBe("string");
  });

  it("refuse d'importer un ouvrage « déjà paru » avec une date de parution future", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts/import",
      headers: { cookie: adminCookie },
      payload: {
        title: "Ouvrage du futur",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "X", last_name: "Y" },
        publication_date: "2999-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("future_publication_date");
  });

  it("renseigne la date de parution d'un ouvrage et trace l'antidatage au journal", async () => {
    const manuscript = await createManuscript("Ouvrage à dater");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/publication-date`,
      headers: { cookie: adminCookie },
      payload: { publication_date: "2020-03-15", note: "Reconstitution d'après le dépôt légal." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicationDate.slice(0, 10)).toBe("2020-03-15");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "manuscript", entityId: manuscript.id, action: "update" },
      orderBy: { occurredAt: "desc" },
    });
    const values = audit?.newValues as Record<string, unknown> | null;
    expect(values?.change).toBe("publication_date");
    expect(values?.antidated).toBe(true);
    expect(values?.note).toBe("Reconstitution d'après le dépôt légal.");
    expect(typeof values?.recorded_at).toBe("string");
  });

  it("refuse l'antidatage à un profil sans permission manuscripts:saisie (403)", async () => {
    const manuscript = await createManuscript("Ouvrage protégé");
    await createUserWithRole("correcteur_antidate_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_antidate_test", "Correcteur123!");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/publication-date`,
      headers: { cookie },
      payload: { publication_date: "2020-03-15" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("expose les étapes du circuit et le suivi de production (voyants)", async () => {
    const statuses = await app.inject({ method: "GET", url: "/api/v1/workflow-statuses", headers: { cookie: adminCookie } });
    expect(statuses.statusCode).toBe(200);
    const steps = statuses.json();
    expect(steps.length).toBe(20);
    expect(steps[0].stepOrder).toBe(1);
    expect(steps[steps.length - 1].stepOrder).toBe(20);

    const tracking = await app.inject({ method: "GET", url: "/api/v1/production-tracking", headers: { cookie: adminCookie } });
    expect(tracking.statusCode).toBe(200);
    const items = tracking.json();
    // « Suivi des ouvrages » : vue d'ensemble de tout le pipeline (dès la
    // réception), pour que l'éditorial voie chaque ouvrage et son étape.
    for (const m of items) {
      expect(m.stepOrder).toBeGreaterThanOrEqual(1);
      expect(m).toHaveProperty("statusLabel");
      expect(m).toHaveProperty("title");
    }
  });
});
