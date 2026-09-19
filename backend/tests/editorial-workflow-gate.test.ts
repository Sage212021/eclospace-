import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// INTÉGRITÉ DU CIRCUIT ÉDITORIAL (demande opérateur) : un manuscrit ne peut pas
// se retrouver en PLANIFICATION sans que le rapport d'évaluation (comité de
// lecture) ET la décision éditoriale aient été réellement rendus.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("garde-fous éditoriaux : évaluation + décision avant planification", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  const created: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => {
    await prisma.evaluation.deleteMany({ where: { assignment: { manuscriptId: { in: created } } } }).catch(() => {});
    await prisma.readingAssignment.deleteMany({ where: { manuscriptId: { in: created } } }).catch(() => {});
    await prisma.editorialDecision.deleteMany({ where: { manuscriptId: { in: created } } }).catch(() => {});
    await prisma.stepTransition.deleteMany({ where: { manuscriptId: { in: created } } }).catch(() => {});
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId: { in: created } } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const manuscriptAt = async (statusCode: string) => {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: statusCode } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-GATE-${rnd()}`, title: `Gate ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() } });
    created.push(m.id);
    return m.id;
  };

  const addEvaluation = async (manuscriptId: string) => {
    const assignment = await prisma.readingAssignment.create({ data: { manuscriptId, readerId: adminId, dueAt: new Date(), status: "submitted", submittedAt: new Date() } });
    await prisma.evaluation.create({ data: { assignmentId: assignment.id, recommendation: "accept", globalScore: 15, rating: "good" } });
  };

  it("refuse une ACCEPTATION sans rapport d'évaluation", async () => {
    const id = await manuscriptAt("DECISION_EDITORIALE");
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie }, payload: { decision: "acceptation", motivation: "Bon manuscrit." } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("evaluation_report_missing");
    // Aucune décision enregistrée, le dossier reste à la décision.
    expect(await prisma.editorialDecision.count({ where: { manuscriptId: id } })).toBe(0);
  });

  it("autorise l'acceptation une fois l'évaluation rendue, et fait passer en planification", async () => {
    const id = await manuscriptAt("DECISION_EDITORIALE");
    await addEvaluation(id);
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie }, payload: { decision: "acceptation", motivation: "Évalué favorablement." } });
    expect(r.statusCode).toBe(201);
    const m = await prisma.manuscript.findUniqueOrThrow({ where: { id }, include: { status: true } });
    expect(m.status.code).toBe("PLANIFICATION");
  });

  it("backstop : un dossier en planification sans évaluation ni décision ne peut pas progresser", async () => {
    const id = await manuscriptAt("PLANIFICATION");
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("editorial_prerequisites_missing");
  });

  it("le back-catalogue (hors circuit) n'est pas bloqué par le backstop", async () => {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "PLANIFICATION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-GATE-${rnd()}`, title: `BackCat ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date(), isBackCatalogue: true } });
    created.push(m.id);
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/PLANIFICATION/validate`, headers: { cookie }, payload: {} });
    // Le backstop ne s'applique pas : la requête n'est PAS rejetée pour cause de
    // prérequis éditoriaux (elle peut échouer plus loin, mais pas sur ce motif).
    expect(r.json().code).not.toBe("editorial_prerequisites_missing");
  });
});
