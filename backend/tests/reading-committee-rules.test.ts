import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Règles « comité professionnel » (audit éditorial, point n°3), activables :
// quorum de lecteurs + déclaration de conflit d'intérêt. Désactivées par
// défaut : le comité fonctionne comme aujourd'hui (un rapport suffit).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("règles du comité de lecture (quorum + conflit d'intérêt)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let committeeStatusId: string;
  let decisionStatusId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    committeeStatusId = (await prisma.workflowStatus.findFirstOrThrow({ where: { code: "COMITE_LECTURE" } })).id;
    decisionStatusId = (await prisma.workflowStatus.findFirstOrThrow({ where: { code: "DECISION_EDITORIALE" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function setRules(rules: { quorumEnabled: boolean; quorum: number; conflictEnabled: boolean }) {
    const r = await app.inject({ method: "PUT", url: "/api/v1/reading-committee-rules", headers: { cookie }, payload: rules });
    expect(r.statusCode).toBe(200);
  }

  async function manuscriptAtCommittee() {
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-CTE-${rnd()}`, title: "Comité", statusId: committeeStatusId, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    return m.id;
  }

  async function assignSelf(manuscriptId: string) {
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/reading-assignments`, headers: { cookie }, payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" } });
    return r.json().id as string;
  }

  async function submitEval(assignmentId: string, extra: Record<string, unknown> = {}) {
    const criteria = await prisma.evaluationCriterion.findMany({ where: { isActive: true } });
    return app.inject({
      method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/evaluation`, headers: { cookie },
      payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 8 })), recommendation: "accept", ...extra },
    });
  }

  async function statusOf(manuscriptId: string) {
    return (await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscriptId }, select: { statusId: true } })).statusId;
  }

  it("désactivé par défaut : un seul rapport suffit à transmettre à la décision", async () => {
    await setRules({ quorumEnabled: false, quorum: 2, conflictEnabled: false });
    const get = await app.inject({ method: "GET", url: "/api/v1/reading-committee-rules", headers: { cookie } });
    expect(get.json().rules.quorumEnabled).toBe(false);
    expect(get.json().rules.conflictEnabled).toBe(false);

    const id = await manuscriptAtCommittee();
    const a = await assignSelf(id);
    const res = await submitEval(a);
    expect(res.statusCode).toBe(201);
    expect(await statusOf(id)).toBe(decisionStatusId); // transmis à la Direction éditoriale
  });

  it("quorum activé : ne transmet pas sous le quorum, transmet une fois atteint", async () => {
    await setRules({ quorumEnabled: true, quorum: 2, conflictEnabled: false });

    // Un seul rapport remis (< 2) : le dossier reste au comité.
    const id = await manuscriptAtCommittee();
    const a = await assignSelf(id);
    const one = await submitEval(a);
    expect(one.statusCode).toBe(201);
    expect(await statusOf(id)).toBe(committeeStatusId);

    // Deux rapports remis (= quorum) : le dossier passe à la décision.
    const id2 = await manuscriptAtCommittee();
    // Premier rapport simulé d'un autre lecteur (déjà remis).
    const reader2 = await prisma.user.create({ data: { username: `reader2-${rnd()}`, email: `reader2-${rnd()}@ex.co`, passwordHash: "x" } });
    await prisma.readingAssignment.create({ data: { manuscriptId: id2, readerId: reader2.id, dueAt: new Date("2026-12-31"), status: "submitted", submittedAt: new Date() } });
    // Second rapport : celui de l'admin, via l'API — déclenche la vérification.
    const b = await assignSelf(id2);
    const two = await submitEval(b);
    expect(two.statusCode).toBe(201);
    expect(await statusOf(id2)).toBe(decisionStatusId);
  });

  it("conflit d'intérêt activé : déclaration exigée, motif requis si conflit, enregistrée", async () => {
    await setRules({ quorumEnabled: false, quorum: 2, conflictEnabled: true });
    const id = await manuscriptAtCommittee();
    const a = await assignSelf(id);

    // Sans déclaration : refus.
    const missing = await submitEval(a);
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe("conflict_declaration_required");

    // Conflit signalé sans motif : refus.
    const noDetails = await submitEval(a, { conflict_declaration: { has_conflict: true } });
    expect(noDetails.statusCode).toBe(400);
    expect(noDetails.json().code).toBe("conflict_details_required");

    // Déclaration « aucun lien » : acceptée et tracée.
    const ok = await submitEval(a, { conflict_declaration: { has_conflict: false } });
    expect(ok.statusCode).toBe(201);
    const assignment = await prisma.readingAssignment.findUniqueOrThrow({ where: { id: a } });
    expect(assignment.conflictDeclaredAt).toBeTruthy();
    expect(assignment.conflictHasConflict).toBe(false);

    await setRules({ quorumEnabled: false, quorum: 2, conflictEnabled: false });
  });
});
