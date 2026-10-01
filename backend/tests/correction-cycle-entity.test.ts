import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import { ensureOpenCorrectionCycle, closeCorrectionCycle, openCorrectionCycle } from "../src/lib/correctionCycleEntity.js";

// PHASE 2 — ENTITÉ « Cycle de correction éditoriale » (demande opérateur 01/10) :
//   • un cycle (référence COR-AAAA-NNN) reste OUVERT à travers tous les
//     allers-retours ; chaque dépôt est un MOUVEMENT historisé (date, utilisateur,
//     rôle, destinataire, version, statut d'étape) ;
//   • valider l'étape Correction CLÔT le cycle (statut TERMINÉE + fiche de
//     clôture : qui, quand, version finale) ;
//   • après clôture, un nouveau cycle (#2) peut être ouvert.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("entité cycle de correction (Phase 2)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function manuscriptAtCorrection() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-C2-${rnd()}`, title: `Cycle2 ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: adminId, actualStart: new Date() } });
    return m;
  }

  it("un dépôt ouvre le cycle (référence COR-AAAA-NNN) et historise un mouvement", async () => {
    const m = await manuscriptAtCorrection();
    const up = multipart("file", "rapport.txt", "Rapport de correction.");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...up.headers }, payload: up.body });
    expect(res.statusCode).toBe(201);

    const cycles = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-cycles`, headers: { cookie } })).json() as any[];
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycleNumber).toBe(1);
    expect(cycles[0].reference).toMatch(/^COR-\d{4}-\d{3}$/);
    expect(cycles[0].status).toBe("en_cours");
    // Mouvement « deposit » historisé avec la version et l'étape.
    const deposits = cycles[0].movements.filter((mv: any) => mv.kind === "deposit");
    expect(deposits).toHaveLength(1);
    expect(deposits[0].userId).toBe(adminId);
    expect(deposits[0].documentVersionId).toBeTruthy();
    expect(deposits[0].stepStatus).toBe("CORRECTION");
  });

  it("la fiche expose le cycle actif (référence + n°)", async () => {
    const m = await manuscriptAtCorrection();
    const up = multipart("file", "rapport.txt", "Rapport.");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...up.headers }, payload: up.body });
    const fiche = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}`, headers: { cookie } })).json();
    expect(fiche.correctionCycle).toBeTruthy();
    expect(fiche.correctionCycle.cycleNumber).toBe(1);
    expect(fiche.correctionCycle.status).toBe("en_cours");
  });

  it("valider l'étape Correction clôt le cycle (TERMINÉE + version finale + clôturé par)", async () => {
    const m = await manuscriptAtCorrection();
    // Pièces obligatoires : 1re correction + VCF + couverture finale.
    for (const [phase, name] of [["rapport_1", "rapport.txt"], ["integration_finale", "vcf.txt"], ["couverture_finale", "cover.txt"]] as const) {
      const up = multipart("file", name, `Contenu ${phase}`);
      const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/${phase}`, headers: { cookie, ...up.headers }, payload: up.body });
      expect(r.statusCode).toBe(201);
    }
    const val = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: { observations: "RAS, cycle clos." } });
    expect(val.statusCode).toBe(200);

    const cycles = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-cycles`, headers: { cookie } })).json() as any[];
    expect(cycles[0].status).toBe("terminee");
    expect(cycles[0].closedBy).toBe(adminId);
    expect(cycles[0].closedAt).toBeTruthy();
    expect(cycles[0].finalVersionId).toBeTruthy();
    expect(cycles[0].movements.some((mv: any) => mv.kind === "closed")).toBe(true);
  });

  it("après clôture, un nouveau cycle (#2) peut être ouvert avec une référence distincte", async () => {
    const m = await manuscriptAtCorrection();
    const c1 = await ensureOpenCorrectionCycle(m.id, { userId: adminId, userRole: "ADMIN_GENERAL" });
    await closeCorrectionCycle(m.id, { userId: adminId, finalVersionId: null });
    const c2 = await ensureOpenCorrectionCycle(m.id, { userId: adminId, userRole: "ADMIN_GENERAL" });
    expect(c2.cycleNumber).toBe(2);
    expect(c2.reference).not.toBe(c1.reference);
    const active = await openCorrectionCycle(m.id);
    expect(active?.id).toBe(c2.id);
    expect(active?.status).toBe("en_cours");
  });

  it("un ouvrage n'a qu'UN cycle actif à la fois (ensureOpen idempotent)", async () => {
    const m = await manuscriptAtCorrection();
    const a = await ensureOpenCorrectionCycle(m.id, { userId: adminId });
    const b = await ensureOpenCorrectionCycle(m.id, { userId: adminId });
    expect(a.id).toBe(b.id);
    const count = await prisma.correctionCycle.count({ where: { manuscriptId: m.id, status: "en_cours" } });
    expect(count).toBe(1);
  });
});
