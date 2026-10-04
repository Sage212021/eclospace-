import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

type Row = {
  manuscript_id: string;
  step_code: string;
  bucket: string;
  blocked_reason: string | null;
  detail: string | null;
};

// « Mes validations de production » (tableau DG) : liste les ouvrages aux étapes
// de fin de chaîne pilotées par la Direction, avec l'action attendue et le motif
// d'attente.
describe("Mes validations de production (tableau DG)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let dgCookie: string;
  let correcteurCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    await createUserWithRole("dg_prodval", "DIR_GENERAL", "DirProdVal123!");
    dgCookie = await loginCookie(app, "dg_prodval", "DirProdVal123!");
    // Un profil SANS manuscripts:validation : l'endpoint doit le refuser (403).
    await createUserWithRole("corr_prodval", "CORRECTEUR", "CorrProdVal123!");
    correcteurCookie = await loginCookie(app, "corr_prodval", "CorrProdVal123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Ouvrage avec BAT signé, placé à l'étape VALIDATION_BAT.
  async function manuscriptAtSignedBat(baseTitle: string) {
    const title = `${baseTitle} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const manuscript = (
      await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie: adminCookie }, payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } } })
    ).json();

    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contract = (await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie: adminCookie }, payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} } })).json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie: adminCookie }, payload: { status } });
    }
    const pool = await app.inject({ method: "POST", url: "/api/v1/isbn-pools", headers: { cookie: adminCookie }, payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 } });
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/isbn`, headers: { cookie: adminCookie }, payload: { format: "print", pool_id: pool.json().id } });
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/legal-deposits`, headers: { cookie: adminCookie }, payload: { country: "France", depository: "BnF", copies_required: 2 } });
    await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscript.id}/metadata`, headers: { cookie: adminCookie }, payload: { summary: "Résumé complet", weight_grams: 350, thema_codes: ["FBA"] } });
    await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscript.id}/production-specs`, headers: { cookie: adminCookie }, payload: { trim_format: "14x21", final_pages: 200, paper_interior: "Offset 80g", paper_interior_gsm: 80, paper_cover: "Couché 250g", binding: "broche" } });
    await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscript.id}/production-specs`, headers: { cookie: adminCookie }, payload: { lamination: "mate" } });
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/image-assets`, headers: { cookie: adminCookie }, payload: { type: "couverture_1", resolution_dpi: 300, color_mode: "cmjn", rights_origin: "creation_interne" } });

    const document = await prisma.document.create({ data: { entityType: "manuscript", entityId: manuscript.id, category: "bat", title: "Fichiers BAT" } });
    const interiorVersion = await prisma.documentVersion.create({ data: { documentId: document.id, versionNumber: 1, filePath: "interior.pdf", fileSize: 1000, mimeType: "application/pdf", sha256Hash: `int-${manuscript.id}`, status: "validated" } });
    const coverVersion = await prisma.documentVersion.create({ data: { documentId: document.id, versionNumber: 2, filePath: "cover.pdf", fileSize: 500, mimeType: "application/pdf", sha256Hash: `cov-${manuscript.id}`, status: "validated" } });
    const bat = (await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/bat`, headers: { cookie: adminCookie }, payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id } })).json();
    for (const item of bat.checklist.items) {
      await app.inject({ method: "PATCH", url: `/api/v1/checklist-items/${item.id}`, headers: { cookie: adminCookie }, payload: { checked: true } });
    }
    await app.inject({ method: "PATCH", url: `/api/v1/bat/${bat.id}/status`, headers: { cookie: adminCookie }, payload: { status: "awaiting_signature" } });
    await app.inject({ method: "POST", url: `/api/v1/bat/${bat.id}/sign`, headers: { cookie: adminCookie }, payload: { author_approval: true } });

    const batStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "VALIDATION_BAT" } });
    await prisma.manuscript.update({ where: { id: manuscript.id }, data: { statusId: batStatus.id } });
    return { manuscript, batStatusId: batStatus.id };
  }

  async function fetchRows(): Promise<Row[]> {
    const r = await app.inject({ method: "GET", url: "/api/v1/my-production-validations", headers: { cookie: dgCookie } });
    expect(r.statusCode).toBe(200);
    return r.json() as Row[];
  }

  it("refuse l'accès à un profil sans droit de validation des manuscrits", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/my-production-validations", headers: { cookie: correcteurCookie } });
    expect(r.statusCode).toBe(403);
  });

  it("un ouvrage au BAT non encore pré-validé est « en attente » (1re signature de l'infographe)", async () => {
    const { manuscript } = await manuscriptAtSignedBat("ProdVal BAT Attente");
    const rows = await fetchRows();
    const row = rows.find((r) => r.manuscript_id === manuscript.id);
    expect(row).toBeTruthy();
    expect(row!.step_code).toBe("VALIDATION_BAT");
    expect(row!.bucket).toBe("en_attente");
    expect(row!.blocked_reason).toContain("1re signature");
  });

  it("un ouvrage au BAT pré-validé passe « à valider » (contre-validation du DG)", async () => {
    const { manuscript, batStatusId } = await manuscriptAtSignedBat("ProdVal BAT A Valider");
    // Pose la pré-validation directement (1re signature).
    await prisma.manuscriptStep.upsert({
      where: { manuscriptId_statusId: { manuscriptId: manuscript.id, statusId: batStatusId } },
      update: { preValidatedAt: new Date(), preValidatedBy: adminId },
      create: { manuscriptId: manuscript.id, statusId: batStatusId, preValidatedAt: new Date(), preValidatedBy: adminId },
    });
    const rows = await fetchRows();
    const row = rows.find((r) => r.manuscript_id === manuscript.id);
    expect(row).toBeTruthy();
    expect(row!.bucket).toBe("en_cours");
    expect(row!.detail).toContain("contre-valider");
  });
});
