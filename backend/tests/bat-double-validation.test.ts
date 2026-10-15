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

// BAT Final à DOUBLE validation (demande opérateur 03/10/2026) : l'infographe de
// production pose la 1re signature (pré-validation, pas d'avancement), la
// Direction générale contre-valide (2e signature), et c'est seulement là que
// l'ouvrage passe à l'impression. La contre-validation est interdite au
// pré-validateur (deux personnes distinctes).
describe("BAT Final — double validation (infographe puis Direction générale)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let infographeCookie: string;
  let dgCookie: string;
  let dgId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;

    await createUserWithRole("infographe_bat_dv", "RESP_INFOGRAPHIE", "InfoBat123!");
    const dg = await createUserWithRole("dg_bat_dv", "DIR_GENERAL", "DirBat123!");
    dgId = dg.id;
    infographeCookie = await loginCookie(app, "infographe_bat_dv", "InfoBat123!");
    dgCookie = await loginCookie(app, "dg_bat_dv", "DirBat123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Assemble un manuscrit avec un BAT SIGNÉ, puis le place à l'étape
  // VALIDATION_BAT (prêt pour la double validation).
  async function manuscriptAtSignedBat(baseTitle: string, opts: { sign?: boolean } = {}) {
    const sign = opts.sign ?? true;
    // Titre unique par exécution : l'anti-doublon refuse un titre déjà enregistré.
    const title = `${baseTitle} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } },
    });
    const manuscript = createResponse.json();
    if (!manuscript?.id) throw new Error(`manuscript create failed ${createResponse.statusCode}: ${createResponse.body.slice(0, 300)}`);

    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contract = (
      await app.inject({
        method: "POST",
        url: "/api/v1/contracts",
        headers: { cookie: adminCookie },
        payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} },
      })
    ).json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie: adminCookie }, payload: { status } });
    }

    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/isbn`, headers: { cookie: adminCookie }, payload: { format: "print", pool_id: pool.json().id } });
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/legal-deposits`, headers: { cookie: adminCookie }, payload: { country: "France", depository: "BnF", copies_required: 2 } });
    await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscript.id}/metadata`, headers: { cookie: adminCookie }, payload: { summary: "Résumé complet", weight_grams: 350, thema_codes: ["FBA"] } });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { trim_format: "14x21", final_pages: 200, paper_interior: "Offset 80g", paper_interior_gsm: 80, paper_cover: "Couché 250g", binding: "broche" },
    });
    await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscript.id}/production-specs`, headers: { cookie: adminCookie }, payload: { lamination: "mate" } });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/image-assets`,
      headers: { cookie: adminCookie },
      payload: { type: "couverture_1", resolution_dpi: 300, color_mode: "cmjn", rights_origin: "creation_interne" },
    });

    const document = await prisma.document.create({ data: { entityType: "manuscript", entityId: manuscript.id, category: "bat", title: "Fichiers BAT" } });
    const interiorVersion = await prisma.documentVersion.create({ data: { documentId: document.id, versionNumber: 1, filePath: "interior.pdf", fileSize: 1000, mimeType: "application/pdf", sha256Hash: `int-${manuscript.id}`, status: "validated" } });
    const coverVersion = await prisma.documentVersion.create({ data: { documentId: document.id, versionNumber: 2, filePath: "cover.pdf", fileSize: 500, mimeType: "application/pdf", sha256Hash: `cov-${manuscript.id}`, status: "validated" } });

    const bat = (
      await app.inject({
        method: "POST",
        url: `/api/v1/manuscripts/${manuscript.id}/bat`,
        headers: { cookie: adminCookie },
        payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
      })
    ).json();

    if (sign) {
      for (const item of bat.checklist.items) {
        await app.inject({ method: "PATCH", url: `/api/v1/checklist-items/${item.id}`, headers: { cookie: adminCookie }, payload: { checked: true } });
      }
      await app.inject({ method: "PATCH", url: `/api/v1/bat/${bat.id}/status`, headers: { cookie: adminCookie }, payload: { status: "awaiting_signature" } });
      await prisma.batRecord.update({ where: { id: bat.id }, data: { signedScanVersionId: interiorVersion.id } });
      await app.inject({ method: "POST", url: `/api/v1/bat/${bat.id}/sign`, headers: { cookie: adminCookie }, payload: { author_approval: true } });
    }

    // Place l'ouvrage à l'étape VALIDATION_BAT.
    const batStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "VALIDATION_BAT" } });
    await prisma.manuscript.update({ where: { id: manuscript.id }, data: { statusId: batStatus.id } });

    return { manuscript, batStatusId: batStatus.id };
  }

  it("l'infographe pré-valide (1re signature) sans faire avancer l'ouvrage et notifie la Direction générale", async () => {
    const { manuscript, batStatusId } = await manuscriptAtSignedBat("BAT DV Prevalidation");

    const pre = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`,
      headers: { cookie: infographeCookie },
      payload: {},
    });
    expect(pre.statusCode).toBe(200);
    expect(pre.json().advanced).toBe(false);
    expect(pre.json().pending_counter_validation).toBe(true);

    // L'ouvrage reste à VALIDATION_BAT, la 1re signature est tracée.
    const afterPre = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id }, select: { statusId: true } });
    expect(afterPre.statusId).toBe(batStatusId);
    const step = await prisma.manuscriptStep.findUniqueOrThrow({ where: { manuscriptId_statusId: { manuscriptId: manuscript.id, statusId: batStatusId } } });
    expect(step.preValidatedAt).not.toBeNull();
    expect(step.validatedAt).toBeNull();

    // La Direction générale est notifiée de la contre-validation attendue.
    const notif = await prisma.notification.findFirst({ where: { userId: dgId, entityId: manuscript.id, title: { startsWith: "BAT à contre-valider" } } });
    expect(notif).not.toBeNull();
  });

  it("l'infographe ne peut pas contre-valider (réservé à la Direction générale)", async () => {
    const { manuscript } = await manuscriptAtSignedBat("BAT DV Infographe Refus Contre");

    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: infographeCookie }, payload: {} });
    const second = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: infographeCookie }, payload: {} });
    expect(second.statusCode).toBe(403);
    expect(second.json().code).toBe("forbidden");
  });

  it("la Direction générale contre-valide (2e signature) : l'ouvrage passe enfin à l'étape suivante", async () => {
    const { manuscript, batStatusId } = await manuscriptAtSignedBat("BAT DV Contre Validation");

    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: infographeCookie }, payload: {} });

    const counter = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`,
      headers: { cookie: dgCookie },
      payload: {},
    });
    expect(counter.statusCode).toBe(200);
    expect(counter.json().advanced).toBe(true);

    const after = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id }, select: { statusId: true } });
    expect(after.statusId).not.toBe(batStatusId);
    const step = await prisma.manuscriptStep.findUniqueOrThrow({ where: { manuscriptId_statusId: { manuscriptId: manuscript.id, statusId: batStatusId } } });
    expect(step.validatedAt).not.toBeNull();
    expect(step.validationBy).toBe(dgId);
  });

  it("le pré-validateur ne peut pas être aussi le contre-validateur, même avec l'autorité (double signature de deux personnes)", async () => {
    const { manuscript, batStatusId } = await manuscriptAtSignedBat("BAT DV Meme Signataire");

    // Admin (autorité de validation) pose la 1re signature…
    const pre = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(pre.json().pending_counter_validation).toBe(true);

    // …et ne peut PAS contre-valider sa propre pré-validation.
    const self = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("bat_same_signer");

    // L'ouvrage n'a pas bougé ; une autre personne (DG) peut contre-valider.
    const stillThere = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id }, select: { statusId: true } });
    expect(stillThere.statusId).toBe(batStatusId);
    const counter = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: dgCookie }, payload: {} });
    expect(counter.statusCode).toBe(200);
    expect(counter.json().advanced).toBe(true);
  });

  it("refuse la pré-validation tant que le BAT n'est pas signé (prérequis du bon à tirer)", async () => {
    const { manuscript } = await manuscriptAtSignedBat("BAT DV Non Signe", { sign: false });

    const pre = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: infographeCookie }, payload: {} });
    expect(pre.statusCode).toBe(409);
    expect(pre.json().code).toBe("bat_not_signed");

    // L'état reflète un bon à tirer PAS encore prêt (déposé mais non signé).
    const state = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/bat-validation-state`, headers: { cookie: dgCookie } });
    expect(state.json().bat_has_interior).toBe(true);
    expect(state.json().bat_signed).toBe(false);
    expect(state.json().bat_ready).toBe(false);
  });

  it("expose l'état de double validation (endpoint bat-validation-state)", async () => {
    const { manuscript } = await manuscriptAtSignedBat("BAT DV Etat");

    const before = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/bat-validation-state`, headers: { cookie: dgCookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json().at_bat).toBe(true);
    expect(before.json().pre_validated).toBe(false);
    // Bon à tirer prêt : fichiers déposés + signé → bat_ready true.
    expect(before.json().bat_has_interior).toBe(true);
    expect(before.json().bat_has_cover).toBe(true);
    expect(before.json().bat_signed).toBe(true);
    expect(before.json().bat_ready).toBe(true);

    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/steps/VALIDATION_BAT/validate`, headers: { cookie: infographeCookie }, payload: {} });

    const afterDg = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/bat-validation-state`, headers: { cookie: dgCookie } });
    expect(afterDg.json().pre_validated).toBe(true);
    expect(afterDg.json().can_counter_validate).toBe(true);
    expect(afterDg.json().pre_validator).not.toBeNull();

    const afterInfo = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/bat-validation-state`, headers: { cookie: infographeCookie } });
    expect(afterInfo.json().is_pre_validator).toBe(true);
    expect(afterInfo.json().can_counter_validate).toBe(false);
  });
});
