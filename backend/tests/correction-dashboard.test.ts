import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Sous-module « Correction éditoriale » (refonte éditoriale) : tableau de bord
// réservé à l'éditorial/direction ; structure des indicateurs et sous-états.
// L'avancement est calculé sur le CIRCUIT RÉEL (phases/livrables déposés), pas
// sur des « tâches ».

const PWD = "Edi123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

// Dépose une phase du circuit de correction (document « pièce d'étape » dont le
// titre porte la clé de phase), exactement comme le fait l'application.
async function depositPhase(manuscriptId: string, phaseKey: string, userId: string) {
  const doc = await prisma.document.create({
    data: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", title: `[correction:${phaseKey}] fichier-${rnd()}.docx`, createdBy: userId, updatedBy: userId },
  });
  await prisma.documentVersion.create({
    data: { documentId: doc.id, versionNumber: 1, filePath: `/tmp/${rnd()}.docx`, fileSize: 1234, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256Hash: rnd().padEnd(64, "0"), uploadedBy: userId },
  });
  return doc.id;
}

describe("tableau de bord du sous-module Correction éditoriale", () => {
  let app: FastifyInstance;
  let edCookie: string;
  let jurCookie: string;
  let edId: string;

  beforeAll(async () => {
    app = await buildApp();
    const ed = `ed_${rnd()}`;
    const edUser = await createUserWithRole(ed, "DIR_EDITORIAL", PWD);
    edId = edUser.id;
    edCookie = await login(app, ed);
    const jur = `jur_${rnd()}`;
    await createUserWithRole(jur, "RESP_JURIDIQUE", PWD);
    jurCookie = await login(app, jur);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("renvoie les indicateurs et sous-états pour un rôle éditorial", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard", headers: { cookie: edCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    for (const k of ["en_correction", "a_affecter", "a_demarrer", "en_cours", "prets_a_valider", "nouveaux_a_traiter", "deuxieme_correction", "en_attente_retour", "points_bloquants_total", "en_retard", "taux_moyen"]) {
      expect(typeof b[k]).toBe("number");
    }
    expect(Array.isArray(b.manuscripts)).toBe(true);
    // Cohérence : la somme des sous-états RÉELS égale le total en correction.
    expect(b.a_affecter + b.a_demarrer + b.en_cours + b.prets_a_valider).toBe(b.en_correction);
  });

  it("refuse un rôle non éditorial (juridique → 403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard", headers: { cookie: jurCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard" });
    expect(res.statusCode).toBe(401);
  });

  it("calcule l'avancement sur les PHASES réellement déposées (pas sur des tâches)", async () => {
    const status = await prisma.workflowStatus.findFirst({ where: { code: "CORRECTION" } });
    expect(status).not.toBeNull();
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `COR-${rnd()}`, title: `Avancement réel ${rnd()}`, language: "fr", statusId: status!.id, ownerId: edId, receivedAt: new Date(), createdBy: edId, updatedBy: edId },
    });

    // Avant tout dépôt : 0 %, non démarré.
    let res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard", headers: { cookie: edCookie } });
    let row = (res.json().manuscripts as Record<string, unknown>[]).find((x) => x.id === m.id)!;
    expect(row).toBeTruthy();
    expect(row.progress_pct).toBe(0);
    expect(row.started).toBe(false);

    // Deux phases TEXTE déposées (1re correction + version intégrée) → 2/8 = 25 %.
    await depositPhase(m.id, "rapport_1", edId);
    await depositPhase(m.id, "integration_1", edId);
    // Une phase COUVERTURE (rapport 1re) → 3/8 ≈ 38 %.
    await depositPhase(m.id, "couverture_1", edId);

    res = await app.inject({ method: "GET", url: "/api/v1/editorial/correction/dashboard", headers: { cookie: edCookie } });
    row = (res.json().manuscripts as Record<string, unknown>[]).find((x) => x.id === m.id)!;
    expect(row.text_done).toBe(2);
    expect(row.cover_done).toBe(1);
    expect(row.phases_done).toBe(3);
    expect(row.phases_total).toBe(8);
    expect(row.progress_pct).toBe(Math.round((3 / 8) * 100)); // 38
    expect(row.started).toBe(true);
    expect(row.sub_state).toBe("en_cours");

    // nettoyage
    await prisma.documentVersion.deleteMany({ where: { document: { entityId: m.id } } }).catch(() => {});
    await prisma.document.deleteMany({ where: { entityId: m.id } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: m.id } }).catch(() => {});
  });
});
