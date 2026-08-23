import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix, seedManuscriptSourceFile, seedCorrectionCycle, seedStepDeliverable, realizationPayload } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("Intégration workflow — étapes 10 à 15 (Lot 3)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let printerId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;

    const partner = await prisma.partner.create({ data: { category: "imprimeur", firstName: "Presses", lastName: "du Fleuve" } });
    const printerResponse = await app.inject({
      method: "POST",
      url: "/api/v1/printers",
      headers: { cookie: adminCookie },
      payload: { partner_id: partner.id, specialties: ["offset"] },
    });
    printerId = printerResponse.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function validate(manuscriptId: string, step: string, payload: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscriptId}/steps/${step}/validate`,
      headers: { cookie: adminCookie },
      payload,
    });
  }

  // Amène un manuscrit jusqu'à l'étape MISE_EN_PAGE (reprend le circuit du Lot 2).
  async function createManuscriptAtMiseEnPage(title: string) {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais", author: { first_name: "Auteur", last_name: title, email: "auteur@example.com", id_type: "CNI", id_number: "100200300" } },
    });
    const manuscript = createResponse.json();
    await seedManuscriptSourceFile(manuscript.id);

    await validate(manuscript.id, "VERIF_ADMIN");
    const assignResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" },
    });
    const assignment = assignResponse.json();
    const criteria = await prisma.evaluationCriterion.findMany();
    await app.inject({
      method: "POST",
      url: `/api/v1/reading-assignments/${assignment.id}/evaluation`,
      headers: { cookie: adminCookie },
      payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 8 })), recommendation: "accept" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/editorial-decision`,
      headers: { cookie: adminCookie },
      payload: { decision: "acceptation", motivation: "Bon texte." },
    });

    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} },
    });
    const contract = contractResponse.json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie: adminCookie }, payload: { status } });
    }
    // D-010 : après la décision, on passe à la PLANIFICATION ; la
    // contractualisation intervient plus tard (juste après la validation du BAT).
    // Ordre D-014 : Planification → Expertise → Réécriture → Correction → Mise en
    // page. On passe Expertise & Réécriture (à option) puis on valide la Correction.
    await seedStepDeliverable(manuscript.id, "PLANIFICATION");
    await validate(manuscript.id, "PLANIFICATION", realizationPayload("PLANIFICATION"));
    await validate(manuscript.id, "EXPERTISE", { step_decision: "passe", skip_reason: "N/A pour ce test" });
    await validate(manuscript.id, "REECRITURE", { step_decision: "passe", skip_reason: "N/A pour ce test" });
    await seedCorrectionCycle(manuscript.id);
    await validate(manuscript.id, "CORRECTION");

    return manuscript;
  }

  it("bloque MISE_EN_PAGE tant qu'aucune fiche technique n'existe (Ch. 11)", async () => {
    const manuscript = await createManuscriptAtMiseEnPage("Manuscrit Workflow Sans Fiche");
    const blocked = await validate(manuscript.id, "MISE_EN_PAGE");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("production_specs_missing");
  });

  it("bloque INFOGRAPHIE tant que la convergence Maquette/Infographie n'est pas atteinte (Ch. 11/12)", async () => {
    const manuscript = await createManuscriptAtMiseEnPage("Manuscrit Workflow Convergence");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { trim_format: "14x21", final_pages: 200, paper_interior: "Offset 80g", paper_interior_gsm: 80, paper_cover: "Couché 250g", binding: "broche" },
    });
    const advanced = await validate(manuscript.id, "MISE_EN_PAGE");
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json().status).toBe("INFOGRAPHIE");

    const blocked = await validate(manuscript.id, "INFOGRAPHIE");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("maquette_infographie_incomplete");
    expect(blocked.json().missing).toContain("dos_a_recalculer");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { lamination: "mate" },
    });
    const stillBlocked = await validate(manuscript.id, "INFOGRAPHIE");
    expect(stillBlocked.statusCode).toBe(409);
    expect(stillBlocked.json().missing).toContain("couverture_non_conforme_ou_sans_droits");

    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/image-assets`,
      headers: { cookie: adminCookie },
      payload: { type: "couverture_1", resolution_dpi: 300, color_mode: "cmjn", rights_origin: "creation_interne" },
    });
    const unblocked = await validate(manuscript.id, "INFOGRAPHIE");
    expect(unblocked.statusCode).toBe(200);
    expect(unblocked.json().status).toBe("ATTRIBUTION_REFERENCES");
  });

  it("mène un manuscrit complet de MISE_EN_PAGE à CONTROLE_QUALITE_IMPRESSION (circuit Ch. 11 à 15)", async () => {
    const manuscript = await createManuscriptAtMiseEnPage("Manuscrit Workflow Complet");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { trim_format: "14x21", final_pages: 200, paper_interior: "Offset 80g", paper_interior_gsm: 80, paper_cover: "Couché 250g", binding: "broche" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { lamination: "mate" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/image-assets`,
      headers: { cookie: adminCookie },
      payload: { type: "couverture_1", resolution_dpi: 300, color_mode: "cmjn", rights_origin: "creation_interne" },
    });

    await validate(manuscript.id, "MISE_EN_PAGE");

    // Ch. 13 §13.9 : ATTRIBUTION_REFERENCES bloquée tant que la complétude n'est pas atteinte.
    const blockedIsbn = await validate(manuscript.id, "INFOGRAPHIE");
    expect(blockedIsbn.statusCode).toBe(200); // convergence déjà atteinte ci-dessus
    const blockedAttribution = await validate(manuscript.id, "ATTRIBUTION_REFERENCES");
    expect(blockedAttribution.statusCode).toBe(409);
    expect(blockedAttribution.json().code).toBe("isbn_completeness_incomplete");

    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/legal-deposits`,
      headers: { cookie: adminCookie },
      payload: { country: "France", depository: "BnF", copies_required: 2 },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/metadata`,
      headers: { cookie: adminCookie },
      payload: { summary: "Résumé complet", weight_grams: 350, thema_codes: ["FBA"] },
    });

    const attributed = await validate(manuscript.id, "ATTRIBUTION_REFERENCES");
    expect(attributed.statusCode).toBe(200);
    expect(attributed.json().status).toBe("VALIDATION_BAT");

    // Ch. 14 §14.6 : VALIDATION_BAT bloquée tant qu'aucun BAT n'est signé.
    const blockedBat = await validate(manuscript.id, "VALIDATION_BAT");
    expect(blockedBat.statusCode).toBe(409);
    expect(blockedBat.json().code).toBe("bat_not_signed");

    const document = await prisma.document.create({ data: { entityType: "manuscript", entityId: manuscript.id, category: "bat", title: "Fichiers BAT" } });
    const interiorVersion = await prisma.documentVersion.create({
      data: { documentId: document.id, versionNumber: 1, filePath: "interior.pdf", fileSize: 1000, mimeType: "application/pdf", sha256Hash: "interiorhash", status: "validated" },
    });
    const coverVersion = await prisma.documentVersion.create({
      data: { documentId: document.id, versionNumber: 2, filePath: "cover.pdf", fileSize: 500, mimeType: "application/pdf", sha256Hash: "coverhash", status: "validated" },
    });
    const opened = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
    });
    const bat = opened.json();
    for (const item of bat.checklist.items) {
      await app.inject({ method: "PATCH", url: `/api/v1/checklist-items/${item.id}`, headers: { cookie: adminCookie }, payload: { checked: true } });
    }
    await app.inject({ method: "PATCH", url: `/api/v1/bat/${bat.id}/status`, headers: { cookie: adminCookie }, payload: { status: "awaiting_signature" } });
    await app.inject({ method: "POST", url: `/api/v1/bat/${bat.id}/sign`, headers: { cookie: adminCookie }, payload: {} });

    const validatedBat = await validate(manuscript.id, "VALIDATION_BAT");
    expect(validatedBat.statusCode).toBe(200);
    // D-010 : la validation du BAT mène désormais à la CONTRACTUALISATION, qui
    // précède l'impression.
    expect(validatedBat.json().status).toBe("CONTRACTUALISATION");

    const validatedContract = await validate(manuscript.id, "CONTRACTUALISATION");
    expect(validatedContract.statusCode).toBe(200);
    expect(validatedContract.json().status).toBe("IMPRESSION");

    // Ch. 15 §15.4 : IMPRESSION bloquée tant qu'aucun bon de commande n'est transmis.
    const blockedImpression = await validate(manuscript.id, "IMPRESSION");
    expect(blockedImpression.statusCode).toBe(409);
    expect(blockedImpression.json().code).toBe("purchase_order_not_sent");

    const quoteResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantities: [500] },
    });
    const quote = quoteResponse.json();
    await app.inject({ method: "PATCH", url: `/api/v1/print-quotes/${quote.id}`, headers: { cookie: adminCookie }, payload: { amounts: { "500": 400000 } } });
    await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/select`,
      headers: { cookie: adminCookie },
      payload: { selection_motive: "OK", chosen_quantity: 500 },
    });
    const poResponse = await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/purchase-order`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    const po = poResponse.json();
    await app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${po.id}/status`, headers: { cookie: adminCookie }, payload: { status: "sent" } });

    const validatedImpression = await validate(manuscript.id, "IMPRESSION");
    expect(validatedImpression.statusCode).toBe(200);
    expect(validatedImpression.json().status).toBe("CONTROLE_QUALITE_IMPRESSION");

    // Ch. 14 §14.7 : contrôle qualité bloqué tant qu'aucune réception n'a de verdict acceptable.
    const blockedCq = await validate(manuscript.id, "CONTROLE_QUALITE_IMPRESSION");
    expect(blockedCq.statusCode).toBe(409);
    expect(blockedCq.json().code).toBe("no_accepted_receipt");

    const receipt = await app.inject({
      method: "POST",
      url: `/api/v1/purchase-orders/${po.id}/goods-receipts`,
      headers: { cookie: adminCookie },
      payload: { quantity_received: 500 },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/goods-receipts/${receipt.json().id}/qc`,
      headers: { cookie: adminCookie },
      payload: { verdict: "conform" },
    });

    const validatedCq = await validate(manuscript.id, "CONTROLE_QUALITE_IMPRESSION");
    expect(validatedCq.statusCode).toBe(200);
    expect(validatedCq.json().status).toBe("ENTREE_STOCK");
  });
});
