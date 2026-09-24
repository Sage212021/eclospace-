import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, seedManuscriptSourceFile } from "./helpers.js";

// RAPPORT D'ÉVALUATION — CHOIX EXCLUSIF (demande opérateur) : recommandation
// PRÉDÉFINIE OU PERSONNALISÉE (texte libre), jamais les deux. Garde-fou métier
// (même en cas de contournement de l'interface).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Rapport d'évaluation — recommandation exclusive (prédéfinie OU personnalisée)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let criteria: { id: string }[];

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    criteria = await prisma.evaluationCriterion.findMany({ select: { id: true } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Crée un manuscrit prêt pour l'évaluation et renvoie l'id d'une mission de lecture.
  async function newAssignment(): Promise<string> {
    const create = await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title: `Reco ${rnd()}`, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais", author: { first_name: "A", last_name: "Reco", email: "a@example.com", id_type: "CNI", id_number: "100200300" } },
    });
    const m = create.json();
    await seedManuscriptSourceFile(m.id);
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/VERIF_ADMIN/validate`, headers: { cookie }, payload: {} });
    const asg = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/reading-assignments`, headers: { cookie }, payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" } });
    return asg.json().id;
  }
  const submit = (assignmentId: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/evaluation`, headers: { cookie }, payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 8 })), ...body } });

  it("mode personnalisé SANS texte → refus 400 (texte obligatoire)", async () => {
    const a = await newAssignment();
    const res = await submit(a, { recommendation: "personnalisee" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("custom_reco_required");
  });

  it("mode personnalisé AVEC texte → enregistre la recommandation personnalisée", async () => {
    const a = await newAssignment();
    const res = await submit(a, { recommendation: "personnalisee", recommendation_note: "Publier en priorité, avec une préface." });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.recommendation).toBe("personnalisee");
    expect(body.recommendationNote).toBe("Publier en priorité, avec une préface.");
  });

  it("recommandation PRÉDÉFINIE + texte libre → le texte est IGNORÉ (exclusivité)", async () => {
    const a = await newAssignment();
    const res = await submit(a, { recommendation: "accept", recommendation_note: "Ceci ne doit pas être enregistré." });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.recommendation).toBe("accept");
    expect(body.recommendationNote).toBeNull();
  });
});
