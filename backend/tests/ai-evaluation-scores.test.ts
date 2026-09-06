import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { extractSessionCookie } = await import("./helpers.js");
const { parseGrilleScores } = await import("../src/lib/aiEvaluationScores.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Notes IA → curseurs d'évaluation (Mes lectures)", () => {
  // — Analyse pure du tableau de grille (indépendante de la base) —
  it("parseGrilleScores extrait les couples (critère → note/10) d'un tableau", () => {
    const report = [
      "## C. Grille d'évaluation",
      "| Critère | Coefficient | Note /10 | Commentaire |",
      "| --- | --- | --- | --- |",
      "| **Qualité de l'écriture** | 2 | 8/10 | Fluide |",
      "| Adéquation avec la ligne éditoriale | 3 | 6 / 10 | Correcte |",
      "| Originalité | 1 | 14/20 | Sur 20 ici |",
      "| Total | | | |",
    ].join("\n");
    const scores = parseGrilleScores(report);
    const byLabel = Object.fromEntries(scores.map((s) => [s.label, s.score]));
    expect(byLabel["Qualité de l'écriture"]).toBe(8);
    expect(byLabel["Adéquation avec la ligne éditoriale"]).toBe(6);
    expect(byLabel["Originalité"]).toBe(7); // 14/20 ramené sur 10
    // Ni l'en-tête ni la ligne « Total » (sans note) ne produisent d'entrée.
    expect(byLabel["Critère"]).toBeUndefined();
    expect(byLabel["Total"]).toBeUndefined();
  });

  it("parseGrilleScores lit une note en NOMBRE SEUL via l'en-tête « Note »", () => {
    // Cas réel : l'IA met la note en nombre seul dans la colonne « Note /10 »
    // (l'en-tête portant déjà « /10 »). Le coefficient ne doit pas être confondu
    // avec la note (ici même valeur « 3 » pour l'un et l'autre sur la 1ʳᵉ ligne).
    const report = [
      "## C. Grille d'évaluation",
      "| Critère | Coefficient | Note /10 | Commentaire |",
      "| --- | --- | --- | --- |",
      "| Originalité et pertinence de la thèse | 3 | 3 | Faible |",
      "| Qualité de l'écriture | 1 | 6,5 | Correcte |",
      "| Score global | | 3,34 | — |",
    ].join("\n");
    const byLabel = Object.fromEntries(parseGrilleScores(report).map((s) => [s.label, s.score]));
    expect(byLabel["Originalité et pertinence de la thèse"]).toBe(3);
    expect(byLabel["Qualité de l'écriture"]).toBe(6.5);
    // « Score global » n'est pas un critère → non retenu.
    expect(byLabel["Score global"]).toBeUndefined();
  });

  it("parseGrilleScores renvoie une liste vide si aucun tableau de notes", () => {
    expect(parseGrilleScores("Un rapport en prose, sans tableau.")).toEqual([]);
    expect(parseGrilleScores(null)).toEqual([]);
  });

  // — Bout en bout : l'endpoint pré-remplit depuis le dernier rapport IA —
  describe("endpoint ai-evaluation-scores + nouvelle recommandation", () => {
    let app: FastifyInstance;
    let adminCookie: string;
    let adminId: string;
    let manuscriptId: string;
    let assignmentId: string;
    let critA: { id: string; label: string };
    let critB: { id: string; label: string };
    const s = Math.random().toString(36).slice(2, 6);

    beforeAll(async () => {
      app = await buildApp();
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
      adminCookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
      adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
      const status = await prisma.workflowStatus.findFirstOrThrow();

      const ms = await prisma.manuscript.create({
        data: { manuscriptNumber: `AIS-${s}`, title: `Ouvrage notes IA ${s}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date() },
      });
      manuscriptId = ms.id;

      // Deux critères de la grille par défaut, pour construire un rapport dont
      // les libellés correspondent (l'un tel quel, l'autre à rapprocher).
      const defaults = await prisma.evaluationCriterion.findMany({ where: { genreId: null, isActive: true }, take: 2, orderBy: { label: "asc" } });
      critA = { id: defaults[0].id, label: defaults[0].label };
      critB = { id: defaults[1].id, label: defaults[1].label };

      const assignment = await prisma.readingAssignment.create({
        data: { manuscriptId, readerId: adminId, dueAt: new Date("2026-12-31T00:00:00.000Z") },
      });
      assignmentId = assignment.id;

      // Rapport IA « terminé » avec une grille reprenant ces deux critères.
      await prisma.aiReadingJob.create({
        data: {
          manuscriptId, workType: "evaluation", status: "termine", promptKey: "evaluation", promptVersion: 1, model: "test",
          finishedAt: new Date(),
          reportText: [
            "## C. Grille d'évaluation",
            "| Critère | Coefficient | Note /10 | Commentaire |",
            "| --- | --- | --- | --- |",
            `| ${critA.label} | 2 | 7/10 | — |`,
            `| ${critB.label} | 3 | 9/10 | — |`,
          ].join("\n"),
        },
      });
    });

    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });

    it("renvoie les notes du dernier rapport IA, rapprochables des critères", async () => {
      const res = await app.inject({ method: "GET", url: `/api/v1/reading-assignments/${assignmentId}/ai-evaluation-scores`, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { available: boolean; scores: { label: string; score: number }[] };
      expect(body.available).toBe(true);
      const byLabel = Object.fromEntries(body.scores.map((x) => [x.label, x.score]));
      expect(byLabel[critA.label]).toBe(7);
      expect(byLabel[critB.label]).toBe(9);
    });

    it("refuse l'accès à la mission d'un autre relecteur", async () => {
      const other = await prisma.readingAssignment.create({
        data: { manuscriptId, readerId: adminId, dueAt: new Date("2026-12-31T00:00:00.000Z") },
      });
      // On force un autre relecteur pour simuler une mission qui n'est pas la nôtre.
      const someoneElse = await prisma.user.create({ data: { username: `other-${s}`, passwordHash: "x", email: `o-${s}@ex.fr` } });
      await prisma.readingAssignment.update({ where: { id: other.id }, data: { readerId: someoneElse.id } });
      const res = await app.inject({ method: "GET", url: `/api/v1/reading-assignments/${other.id}/ai-evaluation-scores`, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(403);
    });

    it("accepte la recommandation « reject_encourage » + champs libres (relecteur, note)", async () => {
      const criteria = await prisma.evaluationCriterion.findMany({ where: { genreId: null, isActive: true } });
      const res = await app.inject({
        method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/evaluation`, headers: { cookie: adminCookie },
        payload: {
          scores: criteria.map((c) => ({ criterion_id: c.id, score: 6 })),
          recommendation: "reject_encourage",
          recommendation_note: "Beau potentiel — à retravailler puis resoumettre.",
          reviewer_name: "Jury interne test",
        },
      });
      expect(res.statusCode).toBe(201);
      const evalRow = await prisma.evaluation.findUniqueOrThrow({ where: { assignmentId } });
      expect(evalRow.recommendation).toBe("reject_encourage");
      expect(evalRow.recommendationNote).toContain("resoumettre");
      expect(evalRow.reviewerName).toBe("Jury interne test");
    });

    it("applique le relecteur par défaut « Comité de lecture d'Éclosion Édition » si le champ est vide", async () => {
      const status = await prisma.workflowStatus.findFirstOrThrow();
      const ms2 = await prisma.manuscript.create({
        data: { manuscriptNumber: `AIS2-${s}`, title: `Ouvrage défaut ${s}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date() },
      });
      const a2 = await prisma.readingAssignment.create({ data: { manuscriptId: ms2.id, readerId: adminId, dueAt: new Date("2026-12-31T00:00:00.000Z") } });
      const criteria = await prisma.evaluationCriterion.findMany({ where: { genreId: null, isActive: true } });
      const res = await app.inject({
        method: "POST", url: `/api/v1/reading-assignments/${a2.id}/evaluation`, headers: { cookie: adminCookie },
        payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 5 })), recommendation: "accept" },
      });
      expect(res.statusCode).toBe(201);
      const evalRow = await prisma.evaluation.findUniqueOrThrow({ where: { assignmentId: a2.id } });
      expect(evalRow.reviewerName).toBe("Comité de lecture d'Éclosion Édition");
    });
  });
});
