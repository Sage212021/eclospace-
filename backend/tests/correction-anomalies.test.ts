import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import { parseAnomaliesJson } from "../src/lib/correctionAnomalies.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Lot 3 — validation humaine des anomalies : extraction robuste du rapport en
// fiches, puis décisions tracées (accepter / modifier / rejeter / à vérifier),
// sans écraser les relectures antérieures.

describe("parseAnomaliesJson — extraction robuste", () => {
  it("lit un JSON enrobé de ```json et normalise sévérité/face", () => {
    const raw = "Voici le résultat :\n```json\n{\"anomalies\":[" +
      "{\"severite\":\"c1\",\"emplacement\":\"p.12\",\"element\":\"des pomme\",\"observation\":\"accord\",\"correction\":\"une pomme\",\"justification\":\"nombre\"}," +
      "{\"severity\":\"X\",\"face\":\"4ème de couverture\",\"element\":\"\",\"observation\":\"\",\"proposal\":\"revoir le résumé\"}," +
      "{\"severity\":\"C3\"}" + // entrée vide → ignorée
      "]}\n```";
    const out = parseAnomaliesJson(raw);
    expect(out).toHaveLength(2);
    expect(out[0].severity).toBe("C1");
    expect(out[0].proposal).toBe("une pomme");
    expect(out[1].severity).toBe("C3"); // « X » invalide → défaut C3
    expect(out[1].face).toBe("4eme");
  });
  it("renvoie [] quand rien d'exploitable", () => {
    expect(parseAnomaliesJson("aucune anomalie ici")).toEqual([]);
    expect(parseAnomaliesJson("")).toEqual([]);
  });
});

describe("Anomalies de correction — décisions tracées (Lot 3)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let manuscriptId: string;
  let job1: string;
  let job2: string;
  const s = Math.random().toString(36).slice(2, 7);

  const mkJob = async (workType: "correction_1" | "correction_2") => {
    const j = await prisma.aiReadingJob.create({
      data: { manuscriptId, workType, promptKey: workType, promptVersion: 1, model: "claude-haiku-4-5", status: "termine", launchedBy: adminId, reportText: "rapport" },
    });
    return j.id;
  };

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-ANO-${s}`, title: `Anomalies ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    job1 = await mkJob("correction_1");
    job2 = await mkJob("correction_2");
    await prisma.correctionAnomaly.createMany({
      data: [
        { jobId: job1, manuscriptId, number: 1, severity: "C1", location: "p.12", element: "des pomme", observation: "accord", proposal: "une pomme" },
        { jobId: job1, manuscriptId, number: 2, severity: "C3", location: "p.40", observation: "répétition", proposal: "varier" },
        { jobId: job2, manuscriptId, number: 1, severity: "C2", location: "p.5", observation: "coquille", proposal: "corriger" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.correctionAnomaly.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.aiReadingJob.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("liste les anomalies de toutes les relectures avec récapitulatif par statut", async () => {
    const r = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/correction-anomalies`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.summary.total).toBe(3);
    expect(body.summary.a_traiter).toBe(3);
    // Les deux relectures sont représentées (aucune n'écrase l'autre).
    expect(new Set(body.anomalies.map((a: { job_id: string }) => a.job_id)).size).toBe(2);
  });

  it("accepter / modifier / rejeter met à jour le statut, la note et le décideur, et trace l'action", async () => {
    const list = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/correction-anomalies`, headers: { cookie } })).json().anomalies as { id: string; status: string }[];
    const a = list[0];
    const ok = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${a.id}`, headers: { cookie }, payload: { status: "modifiee", resolution_note: "préférer « la » pomme" } });
    expect(ok.statusCode).toBe(200);
    const row = await prisma.correctionAnomaly.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe("modifiee");
    expect(row.resolutionNote).toBe("préférer « la » pomme");
    expect(row.decidedById).toBe(adminId);
    expect(row.decidedAt).not.toBeNull();
    const audit = await prisma.auditLog.count({ where: { entityType: "correction_anomaly", entityId: a.id } });
    expect(audit).toBeGreaterThanOrEqual(1);

    const summary = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/correction-anomalies`, headers: { cookie } })).json().summary;
    expect(summary.modifiee).toBe(1);
    expect(summary.a_traiter).toBe(2);
  });

  it("refuse un statut invalide", async () => {
    const list = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/correction-anomalies`, headers: { cookie } })).json().anomalies as { id: string }[];
    const bad = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${list[0].id}`, headers: { cookie }, payload: { status: "n_importe_quoi" } });
    expect(bad.statusCode).toBe(400);
  });
});
