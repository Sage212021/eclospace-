import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Lot 3 — 2ᵉ temps « INTÉGRATION » (branche TEXTE) : l'intégrateur désigné coche
// l'application des corrections retenues, et la version finale (VCF) est bloquée
// tant que tout n'est pas intégré.

function multipart(fieldName: string, filename: string, contentType: string, content: Buffer) {
  const boundary = "----ecl" + Math.random().toString(36).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Correction — intégration par l'intégrateur désigné (Lot 3, branche texte)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let integCookie: string;
  let adminId: string;
  let integId: string;
  let manuscriptId: string;
  let jobId: string;
  let idAcceptee: string;
  let idModifiee: string;
  let idRejetee: string;
  let infographId: string;
  let infographCookie: string;
  let idCoverA: string;
  let idCoverB: string;
  const s = Math.random().toString(36).slice(2, 7);

  const login = async (username: string, password: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const integ = await createUserWithRole(`integ_${s}`, "ASSISTANT_EDITORIAL", "Integ1!pass");
    integId = integ.id;
    integCookie = await login(`integ_${s}`, "Integ1!pass");

    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-INTEG-${s}`, title: `Intégration ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    const job = await prisma.aiReadingJob.create({ data: { manuscriptId, workType: "correction_1", promptKey: "correction_1", promptVersion: 1, model: "claude-haiku-4-5", status: "termine", launchedBy: adminId, reportText: "rapport" } });
    jobId = job.id;
    const acc = await prisma.correctionAnomaly.create({ data: { jobId, manuscriptId, number: 1, severity: "C1", proposal: "une pomme", status: "acceptee" } });
    const mod = await prisma.correctionAnomaly.create({ data: { jobId, manuscriptId, number: 2, severity: "C2", proposal: "varier", status: "modifiee", resolutionNote: "préférer « alterner »" } });
    const rej = await prisma.correctionAnomaly.create({ data: { jobId, manuscriptId, number: 3, severity: "C3", proposal: "x", status: "rejetee" } });
    idAcceptee = acc.id; idModifiee = mod.id; idRejetee = rej.id;

    // — Branche COUVERTURE : un infographe (resp. étape Infographie) + un job
    //   couverture avec deux anomalies acceptées (1ère de couverture). —
    const infograph = await createUserWithRole(`info_${s}`, "RESP_INFOGRAPHIE", "Info1!pass");
    infographId = infograph.id;
    infographCookie = await login(`info_${s}`, "Info1!pass");
    const infoStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "INFOGRAPHIE" } });
    await prisma.manuscriptStep.create({ data: { manuscriptId, statusId: infoStatus.id, responsibleId: infographId } });
    const jobCover = await prisma.aiReadingJob.create({ data: { manuscriptId, workType: "couverture", promptKey: "couverture", promptVersion: 1, model: "claude-haiku-4-5", status: "termine", launchedBy: adminId, reportText: "rapport couverture" } });
    const covA = await prisma.correctionAnomaly.create({ data: { jobId: jobCover.id, manuscriptId, number: 1, severity: "C1", face: "1ere", proposal: "corriger le titre", status: "acceptee" } });
    const covB = await prisma.correctionAnomaly.create({ data: { jobId: jobCover.id, manuscriptId, number: 2, severity: "C2", face: "4eme", proposal: "corriger le résumé", status: "acceptee" } });
    idCoverA = covA.id; idCoverB = covB.id;
  });

  afterAll(async () => {
    await prisma.correctionAnomaly.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.aiReadingJob.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.document.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { userId: { in: [integId, infographId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [integId, infographId] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse l'intégration à qui n'est pas l'intégrateur désigné", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idAcceptee}/integration`, headers: { cookie: integCookie }, payload: { integration_status: "integree" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("not_integrator");
  });

  it("désigne l'intégrateur puis lui permet de cocher « intégrée »", async () => {
    const d = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${manuscriptId}/correction-integrator`, headers: { cookie: adminCookie }, payload: { user_id: integId } });
    expect(d.statusCode).toBe(200);

    const r = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idAcceptee}/integration`, headers: { cookie: integCookie }, payload: { integration_status: "integree" } });
    expect(r.statusCode).toBe(200);
    const row = await prisma.correctionAnomaly.findUniqueOrThrow({ where: { id: idAcceptee } });
    expect(row.integrationStatus).toBe("integree");
    expect(row.integratedById).toBe(integId);
  });

  it("refuse d'intégrer une anomalie rejetée, et « non applicable » sans motif", async () => {
    const rej = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idRejetee}/integration`, headers: { cookie: integCookie }, payload: { integration_status: "integree" } });
    expect(rej.statusCode).toBe(409);
    expect(rej.json().code).toBe("not_integrable");

    const na = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idModifiee}/integration`, headers: { cookie: integCookie }, payload: { integration_status: "non_applicable" } });
    expect(na.statusCode).toBe(400);
    expect(na.json().code).toBe("note_required");
  });

  it("l'inbox de l'intégrateur liste l'ouvrage avec le reste à intégrer", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/my-correction-integrations", headers: { cookie: integCookie } });
    expect(r.statusCode).toBe(200);
    const mine = (r.json().manuscripts as Array<{ id: string; counts: { total: number; integree: number; a_integrer: number } }>).find((x) => x.id === manuscriptId);
    expect(mine).toBeTruthy();
    expect(mine!.counts.total).toBe(2); // acceptée + modifiée (la rejetée ne compte pas)
    expect(mine!.counts.integree).toBe(1); // l'acceptée
    expect(mine!.counts.a_integrer).toBe(1); // la modifiée
  });

  it("VERROU : la version finale est bloquée tant qu'une correction retenue n'est pas intégrée", async () => {
    const mp = multipart("file", "vcf.txt", "text/plain", Buffer.from("version finale"));
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/integration_finale`, headers: { cookie: adminCookie, "content-type": mp.contentType }, payload: mp.body });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("integration_incomplete");

    // On intègre la dernière (modifiée) → plus rien en attente.
    const ok = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idModifiee}/integration`, headers: { cookie: integCookie }, payload: { integration_status: "integree" } });
    expect(ok.statusCode).toBe(200);

    const mp2 = multipart("file", "vcf.txt", "text/plain", Buffer.from("version finale"));
    const passed = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/correction-cycle/integration_finale`, headers: { cookie: adminCookie, "content-type": mp2.contentType }, payload: mp2.body });
    expect(passed.statusCode).toBe(201);
  });

  // — Branche COUVERTURE (Livraison 2) : l'infographe intègre la couverture. —
  it("couverture : l'infographe intègre, l'intégrateur éditorial n'y touche pas (et réciproquement)", async () => {
    // L'intégrateur éditorial (texte) ne peut pas intégrer une anomalie de couverture.
    const wrong = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idCoverA}/integration`, headers: { cookie: integCookie }, payload: { integration_status: "integree" } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe("not_integrator");
    // L'infographe, lui, peut.
    const ok = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idCoverA}/integration`, headers: { cookie: infographCookie }, payload: { integration_status: "integree" } });
    expect(ok.statusCode).toBe(200);
    // L'infographe ne peut PAS intégrer une anomalie de texte.
    const cross = await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idAcceptee}/integration`, headers: { cookie: infographCookie }, payload: { integration_status: "integree" } });
    expect(cross.statusCode).toBe(403);
  });

  it("l'inbox de l'infographe liste l'ouvrage en branche « couverture »", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/my-correction-integrations", headers: { cookie: infographCookie } });
    expect(r.statusCode).toBe(200);
    const rows = r.json().manuscripts as Array<{ id: string; branch: string; counts: { total: number } }>;
    const cover = rows.find((x) => x.id === manuscriptId && x.branch === "couverture");
    expect(cover).toBeTruthy();
    expect(cover!.counts.total).toBe(2); // covA + covB
  });

  it("VERROU couverture : le BAT ne s'ouvre pas tant qu'une correction de couverture n'est pas intégrée", async () => {
    // covB reste « à intégrer » → le BAT doit signaler la couverture non intégrée.
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/bat`, headers: { cookie: adminCookie }, payload: { interior_version_id: "00000000-0000-0000-0000-000000000000", cover_version_id: "00000000-0000-0000-0000-000000000000" } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("bat_convergence_incomplete");
    expect(blocked.json().missing).toContain("corrections_couverture_non_integrees");

    // Une fois covB intégrée, ce motif précis disparaît (le BAT reste bloqué par
    // les autres prérequis amont, mais plus par la couverture).
    await app.inject({ method: "PATCH", url: `/api/v1/correction-anomalies/${idCoverB}/integration`, headers: { cookie: infographCookie }, payload: { integration_status: "integree" } });
    const after = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/bat`, headers: { cookie: adminCookie }, payload: { interior_version_id: "00000000-0000-0000-0000-000000000000", cover_version_id: "00000000-0000-0000-0000-000000000000" } });
    expect(after.json().missing ?? []).not.toContain("corrections_couverture_non_integrees");
  });
});
