import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Correction éditoriale en deux temps : rapport de correction → intégration →
// 2e relecture → intégration finale. On ne valide pas l'étape tant que le
// rapport ET la version finale intégrée ne sont pas déposés.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

async function manuscriptAtCorrection() {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-COR-${rnd()}`, title: `Correction ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

describe("correction éditoriale en deux temps", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("les 4 phases sont proposées, vides au départ", async () => {
    const m = await manuscriptAtCorrection();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-cycle`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const phases = res.json() as { key: string; required: boolean; has_file: boolean }[];
    expect(phases.map((p) => p.key)).toEqual(["rapport_1", "integration_1", "relecture_2", "integration_finale"]);
    expect(phases.filter((p) => p.required).map((p) => p.key)).toEqual(["rapport_1", "integration_1", "relecture_2", "integration_finale"]);
    expect(phases.every((p) => !p.has_file)).toBe(true);
  });

  it("interdit de déposer la version finale (VCF) tant que les étapes précédentes manquent (ordre du cycle, 10/10)", async () => {
    const m = await manuscriptAtCorrection();
    const mp = multipart("file", "vcf.pdf", "VCF sans les étapes précédentes");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/integration_finale`, headers: { cookie, ...mp.headers }, payload: mp.body });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("cycle_order_violation");
    // Le message cite les étapes manquantes (1re correction, version intégrée, 2e relecture).
    expect(res.json().message).toContain("1re correction");
  });

  it("déposer la 2e correction (relecture) exige d'abord la version intégrée", async () => {
    const m = await manuscriptAtCorrection();
    // 1re correction OK, mais pas la version intégrée → la 2e relecture est bloquée.
    const r1 = multipart("file", "rapport.txt", "1re correction");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...r1.headers }, payload: r1.body });
    const r3 = multipart("file", "relecture.txt", "2e relecture avant intégration");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/relecture_2`, headers: { cookie, ...r3.headers }, payload: r3.body });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("cycle_order_violation");
    expect(res.json().message).toContain("Version intégrée");
  });

  it("remplacer une pièce déjà déposée reste possible même hors ordre (corriger un mauvais fichier)", async () => {
    const m = await manuscriptAtCorrection();
    // Dépôt de la 1re correction, puis REMPLACEMENT : autorisé (c'est un remplacement).
    const r1 = multipart("file", "rapport.txt", "1re correction v1");
    const first = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...r1.headers }, payload: r1.body });
    expect(first.statusCode).toBe(201);
    const r1bis = multipart("file", "rapport.txt", "1re correction v2 (bon fichier)");
    const replace = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...r1bis.headers }, payload: r1bis.body });
    expect(replace.statusCode).toBe(201);
  });

  it("bloque la validation tant que rapport + version finale intégrée manquent, puis autorise", async () => {
    const m = await manuscriptAtCorrection();

    // Rien déposé → refus.
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("correction_cycle_incomplete");
    expect(blocked.json().message).toContain("1re correction");

    // Dépôt du rapport seul → toujours refusé (version finale manquante).
    const up1 = multipart("file", "rapport.txt", "Rapport de correction.");
    const r1 = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...up1.headers }, payload: up1.body });
    expect(r1.statusCode).toBe(201);
    const stillBlocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(stillBlocked.statusCode).toBe(409);
    expect(stillBlocked.json().message).toContain("Version corrigée finale");

    // Ordre du cycle : on dépose la version intégrée puis la 2e relecture avant
    // la version corrigée finale (sinon « cycle_order_violation »).
    const upInteg = multipart("file", "integ.txt", "Version intégrée.");
    expect((await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/integration_1`, headers: { cookie, ...upInteg.headers }, payload: upInteg.body })).statusCode).toBe(201);
    const upRelecture = multipart("file", "relecture.txt", "2e relecture.");
    expect((await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/relecture_2`, headers: { cookie, ...upRelecture.headers }, payload: upRelecture.body })).statusCode).toBe(201);

    // Dépôt de la version finale intégrée → toujours refusé : la couverture
    // corrigée finale (1ʳᵉ, dos, 4ᵉ) est désormais exigée pour clôturer.
    const up2 = multipart("file", "final.txt", "Version finale intégrée.");
    const r2 = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/integration_finale`, headers: { cookie, ...up2.headers }, payload: up2.body });
    expect(r2.statusCode).toBe(201);
    const coverStill = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(coverStill.statusCode).toBe(409);
    expect(coverStill.json().message).toContain("Couverture corrigée finale");

    // Cycle couverture obligatoire et ordonné : on dépose les 4 pièces de
    // couverture dans l'ordre → validation possible.
    for (const key of ["couverture_1", "couverture_integration_1", "couverture_2", "couverture_finale"]) {
      const upc = multipart("file", `${key}.txt`, `Couverture — ${key}.`);
      const rc = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/${key}`, headers: { cookie, ...upc.headers }, payload: upc.body });
      expect(rc.statusCode).toBe(201);
    }

    const meta = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-cycle`, headers: { cookie } });
    const rows = meta.json() as { key: string; has_file: boolean; uploaded_by_name: string | null; version_number: number | null; created_at: string | null }[];
    const byKey = Object.fromEntries(rows.map((p) => [p.key, p.has_file]));
    expect(byKey.rapport_1).toBe(true);
    expect(byKey.integration_finale).toBe(true);
    // Retour transmis consultable sur la fiche globale : date + auteur + version.
    const r1row = rows.find((p) => p.key === "rapport_1")!;
    expect(r1row.uploaded_by_name).toBe("admin");
    expect(r1row.version_number).toBe(1);
    expect(r1row.created_at).toBeTruthy();

    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/steps/CORRECTION/validate`, headers: { cookie }, payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().advanced).toBe(true);
  });

  it("relais : désignation de l'intégrateur (Direction/Assistant éditorial) + passage de main + notifications", async () => {
    const integ = await createUserWithRole(`integ_${rnd()}`, "DIR_EDITORIAL", "Integ123!");
    const m = await manuscriptAtCorrection();

    // La liste des intégrateurs inclut ce Directeur éditorial.
    const list = await app.inject({ method: "GET", url: "/api/v1/correction-integrators", headers: { cookie } });
    expect((list.json() as { id: string }[]).some((u) => u.id === integ.id)).toBe(true);

    // Un utilisateur hors pôle éditorial est refusé comme intégrateur.
    const corr = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Corr123!");
    const bad = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${m.id}/correction-integrator`, headers: { cookie }, payload: { user_id: corr.id } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("invalid_integrator");

    // Désignation valide.
    const set = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${m.id}/correction-integrator`, headers: { cookie }, payload: { user_id: integ.id } });
    expect(set.statusCode).toBe(200);

    // État initial : balle au correcteur.
    const s0 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-integrator`, headers: { cookie } });
    expect(s0.json().integrator.id).toBe(integ.id);
    expect(s0.json().current_actor).toBe("correcteur");

    // 1re correction déposée → la balle passe à l'intégrateur, qui est notifié.
    const up = multipart("file", "corr1.txt", "1re correction");
    const dep = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/rapport_1`, headers: { cookie, ...up.headers }, payload: up.body });
    expect(dep.statusCode).toBe(201);
    const s1 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/correction-integrator`, headers: { cookie } });
    expect(s1.json().current_actor).toBe("integrateur");
    const notif = await prisma.notification.count({ where: { userId: integ.id, entityType: "manuscript", entityId: m.id } });
    expect(notif).toBeGreaterThan(0);
  });

  it("refuse une phase inconnue (400)", async () => {
    const m = await manuscriptAtCorrection();
    const up = multipart("file", "x.txt", "y");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/correction-cycle/phase_bidon`, headers: { cookie, ...up.headers }, payload: up.body });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_phase");
  });
});
