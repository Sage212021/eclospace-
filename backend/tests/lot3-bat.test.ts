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

describe("BAT et contrôle qualité (Lot 3)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;
    // notifyRole diffuse aux titulaires actifs du rôle : le seed ne pourvoit
    // que ADMIN_GENERAL, il faut des titulaires de test pour RESP_IMPRESSION/DIR_GENERAL.
    await createUserWithRole("resp_impression_bat_test", "RESP_IMPRESSION", "RespImpression123!");
    await createUserWithRole("dir_general_bat_test", "DIR_GENERAL", "DirGeneral123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Assemble un manuscrit prêt pour le BAT : contrat actif, ISBN/dépôt légal/
  // métadonnées complets, fiche technique de fabrication, couverture conforme.
  async function createManuscriptReadyForBat(title: string) {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Auteur", last_name: title },
      },
    });
    const manuscript = createResponse.json();

    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} },
    });
    const contract = contractResponse.json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({
        method: "PATCH",
        url: `/api/v1/contracts/${contract.id}/status`,
        headers: { cookie: adminCookie },
        payload: { status },
      });
    }

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

    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: {
        trim_format: "14x21",
        final_pages: 200,
        paper_interior: "Offset 80g",
        paper_interior_gsm: 80,
        paper_cover: "Couché 250g",
        binding: "broche",
      },
    });
    // Acquitte l'alerte de recalcul du dos déclenchée par le patch précédent
    // (Ch. 12 §12.3) : une modification ultérieure sans changer pages/papier la lève.
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

    const document = await prisma.document.create({
      data: { entityType: "manuscript", entityId: manuscript.id, category: "bat", title: "Fichiers BAT" },
    });
    const interiorVersion = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 1,
        filePath: "interior.pdf",
        fileSize: 1000,
        mimeType: "application/pdf",
        sha256Hash: "interiorhash",
        status: "validated",
      },
    });
    const coverVersion = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 2,
        filePath: "cover.pdf",
        fileSize: 500,
        mimeType: "application/pdf",
        sha256Hash: "coverhash",
        status: "validated",
      },
    });

    return { manuscript, interiorVersion, coverVersion };
  }

  it("bloque l'ouverture du BAT tant que la convergence amont n'est pas atteinte (Ch. 14 §14.2)", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title: "Manuscrit Incomplet",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "In", last_name: "Complet" },
      },
    });
    const manuscript = createResponse.json();

    const attempt = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: "00000000-0000-0000-0000-000000000000", cover_version_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(attempt.statusCode).toBe(409);
    expect(attempt.json().code).toBe("bat_convergence_incomplete");
    expect(attempt.json().missing).toContain("isbn_metadonnees_incomplet");
    expect(attempt.json().missing).toContain("fiche_technique_incomplete");
    expect(attempt.json().missing).toContain("couverture_non_conforme_ou_sans_droits");
  });

  it("bloque même avec une couverture techniquement conforme si les droits iconographiques ne sont pas documentés (Ch. 12 §12.5)", async () => {
    const { manuscript, interiorVersion, coverVersion } = await createManuscriptReadyForBat("Manuscrit Couverture Sans Droits");

    // La couverture conforme créée par le fixture a des droits documentés :
    // on ajoute une seconde couverture techniquement bonne mais sans droits,
    // ce qui ne change rien puisque le contrôle vérifie l'existence d'au
    // moins une couverture conforme ET pourvue de ses droits — donc on
    // retire d'abord les droits de la couverture existante pour isoler le cas.
    await prisma.imageAsset.updateMany({ where: { manuscriptId: manuscript.id, type: "couverture_1" }, data: { rightsOrigin: null } });

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().missing).toEqual(["couverture_non_conforme_ou_sans_droits"]);
  });

  it("ouvre le dossier, contrôle, signe et verrouille les fichiers (circuit complet Ch. 14)", async () => {
    const { manuscript, interiorVersion, coverVersion } = await createManuscriptReadyForBat("Manuscrit BAT Complet");

    const opened = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
    });
    expect(opened.statusCode).toBe(201);
    const bat = opened.json();
    expect(bat.status).toBe("in_control");
    expect(bat.checklist.items.length).toBeGreaterThan(0);

    // Signature refusée tant que les points bloquants ne sont pas cochés.
    const prematureStatus = await app.inject({
      method: "PATCH",
      url: `/api/v1/bat/${bat.id}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "awaiting_signature" },
    });
    expect(prematureStatus.statusCode).toBe(409);
    expect(prematureStatus.json().code).toBe("control_incomplete");

    for (const item of bat.checklist.items) {
      await app.inject({
        method: "PATCH",
        url: `/api/v1/checklist-items/${item.id}`,
        headers: { cookie: adminCookie },
        payload: { checked: true },
      });
    }

    const readyForSignature = await app.inject({
      method: "PATCH",
      url: `/api/v1/bat/${bat.id}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "awaiting_signature" },
    });
    expect(readyForSignature.statusCode).toBe(200);
    expect(readyForSignature.json().status).toBe("awaiting_signature");

    const signed = await app.inject({
      method: "POST",
      url: `/api/v1/bat/${bat.id}/sign`,
      headers: { cookie: adminCookie },
      payload: { author_approval: true },
    });
    expect(signed.statusCode).toBe(201);
    expect(signed.json().filesHash).toHaveLength(64);

    const afterSign = await prisma.batRecord.findUniqueOrThrow({ where: { id: bat.id } });
    expect(afterSign.status).toBe("signed");

    const printerNotification = await prisma.notification.findFirst({
      where: { entityId: bat.id, title: "BAT signé — bon pour impression" },
    });
    expect(printerNotification).not.toBeNull();

    // Verrouillage : impossible de modifier le contrôle après signature.
    const lockedEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/checklist-items/${bat.checklist.items[0].id}`,
      headers: { cookie: adminCookie },
      payload: { observation: "Tentative après signature" },
    });
    expect(lockedEdit.statusCode).toBe(409);
    expect(lockedEdit.json().code).toBe("bat_locked");
  });

  it("renvoie en correction sur anomalie bloquante puis ouvre un nouveau cycle (Ch. 14 §14.4)", async () => {
    const { manuscript, interiorVersion, coverVersion } = await createManuscriptReadyForBat("Manuscrit BAT Anomalie");
    const opened = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
    });
    const bat = opened.json();

    const anomaly = await app.inject({
      method: "POST",
      url: `/api/v1/bat/${bat.id}/anomalies`,
      headers: { cookie: adminCookie },
      payload: { description: "Faute d'orthographe sur le titre", severity: "blocking", location: "couverture" },
    });
    expect(anomaly.statusCode).toBe(201);

    const returned = await app.inject({
      method: "PATCH",
      url: `/api/v1/bat/${bat.id}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "corrections_requested" },
    });
    expect(returned.statusCode).toBe(200);
    expect(returned.json().status).toBe("corrections_requested");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/bat-anomalies/${anomaly.json().id}/resolve`,
      headers: { cookie: adminCookie },
    });

    const reopened = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat/reopen`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(reopened.statusCode).toBe(201);
    expect(reopened.json().cycleNumber).toBe(2);
    expect(reopened.json().status).toBe("in_control");
  });

  it("l'annulation d'un BAT signé exige une motivation et notifie la direction (Ch. 14 §14.5)", async () => {
    const { manuscript, interiorVersion, coverVersion } = await createManuscriptReadyForBat("Manuscrit BAT Annulation");
    const opened = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
    });
    const bat = opened.json();
    for (const item of bat.checklist.items) {
      await app.inject({
        method: "PATCH",
        url: `/api/v1/checklist-items/${item.id}`,
        headers: { cookie: adminCookie },
        payload: { checked: true },
      });
    }
    await app.inject({
      method: "PATCH",
      url: `/api/v1/bat/${bat.id}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "awaiting_signature" },
    });
    await app.inject({ method: "POST", url: `/api/v1/bat/${bat.id}/sign`, headers: { cookie: adminCookie }, payload: {} });

    const missingJustification = await app.inject({
      method: "POST",
      url: `/api/v1/bat/${bat.id}/cancel-signature`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(missingJustification.statusCode).toBe(400);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/bat/${bat.id}/cancel-signature`,
      headers: { cookie: adminCookie },
      payload: { justification: "Erreur de prix découverte après signature" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");

    const notification = await prisma.notification.findFirst({ where: { entityId: bat.id, title: "Annulation d'un BAT signé" } });
    expect(notification).not.toBeNull();
  });
});
