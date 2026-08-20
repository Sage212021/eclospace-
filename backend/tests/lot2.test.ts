import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { storeFile } from "../src/lib/storage.js";
import { createUserWithRole, extractSessionCookie, seedManuscriptSourceFile, seedCorrectionCycle, seedStepDeliverable } from "./helpers.js";
import { buildDocx } from "./docxFixture.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("contrats, tâches/Gantt, correction et comparateur (Lot 2)", () => {
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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createManuscriptAtCorrection(title: string) {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        evaluation_fee_choice: "sans_frais",
        author: { first_name: "Auteur", last_name: title, email: "auteur@example.com", id_type: "CNI", id_number: "100200300" },
      },
    });
    const manuscript = createResponse.json();
    await seedManuscriptSourceFile(manuscript.id);

    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/VERIF_ADMIN/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
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
      payload: {
        type: "edition",
        manuscript_id: manuscript.id,
        partner_id: partnerId,
        financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] },
      },
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

    // D-010 : après la décision éditoriale, le manuscrit est à la PLANIFICATION.
    // On la valide pour l'amener à la CORRECTION (la contractualisation
    // n'intervient plus ici, mais après la validation du BAT).
    await seedStepDeliverable(manuscript.id, "PLANIFICATION");
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/PLANIFICATION/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });

    // Livrables obligatoires du cycle de correction (rapport + version finale
    // intégrée) pour pouvoir valider l'étape CORRECTION.
    await seedCorrectionCycle(manuscript.id);
    return manuscript;
  }

  it("le rapport de lecture remis est inclus dans les missions du relecteur (téléchargement du rapport)", async () => {
    const manuscript = await createManuscriptAtCorrection(`Rapport ${Date.now()}`);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reading-assignments?reader=me",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const mine = res.json().find((a: { manuscript?: { id: string } }) => a.manuscript?.id === manuscript.id);
    expect(mine).toBeTruthy();
    // L'évaluation remise doit être fournie, avec ses notes par critère (labellées)
    // et sa recommandation — de quoi générer le rapport imprimable côté relecteur.
    expect(mine.evaluation).toBeTruthy();
    expect(mine.evaluation.recommendation).toBe("accept");
    expect(mine.evaluation.scores.length).toBeGreaterThan(0);
    expect(mine.evaluation.scores[0].criterion.label).toBeTruthy();
    expect(mine.reader.username).toBe("admin");
  });

  it("le relecteur peut joindre un fichier de rapport de relecture, téléchargeable ensuite", async () => {
    const manuscript = await createManuscriptAtCorrection(`Fichier ${Date.now()}`);
    const list = (
      await app.inject({ method: "GET", url: "/api/v1/reading-assignments?reader=me", headers: { cookie: adminCookie } })
    ).json();
    const mine = list.find((a: { manuscript?: { id: string } }) => a.manuscript?.id === manuscript.id);
    expect(mine.hasReportFile).toBe(false);

    const boundary = `----test${Date.now()}`;
    const content = "Rapport de lecture détaillé.";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rapport.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    const up = await app.inject({
      method: "POST",
      url: `/api/v1/reading-assignments/${mine.id}/report-file`,
      headers: { cookie: adminCookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().has_report_file).toBe(true);

    const list2 = (
      await app.inject({ method: "GET", url: "/api/v1/reading-assignments?reader=me", headers: { cookie: adminCookie } })
    ).json();
    expect(list2.find((a: { id: string }) => a.id === mine.id).hasReportFile).toBe(true);

    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/reading-assignments/${mine.id}/report-file`,
      headers: { cookie: adminCookie },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("Rapport de lecture détaillé");
  });

  it("le circuit de validation du contrat interdit tout saut d'étape", async () => {
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Test", lastName: "Contrat" } });
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: { type: "edition", partner_id: partner.id, financial_terms: {} },
    });
    const contract = contractResponse.json();

    const jump = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.id}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "active" },
    });
    expect(jump.statusCode).toBe(409);

    const step = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.id}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "legal_review" },
    });
    expect(step.statusCode).toBe(200);
  });

  it("un rôle sans permission contracts:saisie ne peut pas créer de contrat", async () => {
    await createUserWithRole("correcteur_contract_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_contract_test", "Correcteur123!");
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "X", lastName: "Y" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie },
      payload: { type: "edition", partner_id: partner.id, financial_terms: {} },
    });
    expect(response.statusCode).toBe(403);
  });

  it("laisse la production démarrer sans contrat d'édition (D-010 : contrat après le BAT)", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sans Contrat",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        evaluation_fee_choice: "sans_frais",
        author: { first_name: "Sans", last_name: "Contrat", email: "auteur@example.com", id_type: "CNI", id_number: "100200300" },
      },
    });
    const manuscript = createResponse.json();
    await seedManuscriptSourceFile(manuscript.id);
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/VERIF_ADMIN/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" },
    });
    const assignment = blocked.json();
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
      payload: { decision: "acceptation", motivation: "OK" },
    });

    // Après la décision éditoriale, le manuscrit est à la PLANIFICATION (D-010).
    const afterDecision = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id }, include: { status: true } });
    expect(afterDecision.status.code).toBe("PLANIFICATION");

    // La production démarre SANS contrat : valider la planification réussit et
    // mène à la correction (l'ancien verrou « contrat requis » est supprimé).
    await seedStepDeliverable(manuscript.id, "PLANIFICATION");
    const attempt = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/PLANIFICATION/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(attempt.statusCode).toBe(200);
    expect(attempt.json().status).toBe("CORRECTION");
  });

  it("saute l'étape EXPERTISE quand elle n'est pas requise (régression Ch. 4 §4.3)", async () => {
    const manuscript = await createManuscriptAtCorrection("Manuscrit Sans Expertise");
    const stored = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id } });
    expect(stored.requiresExpertise).toBe(false);

    const validate = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/CORRECTION/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(validate.statusCode).toBe(200);
    expect(validate.json().status).toBe("MISE_EN_PAGE");
  });

  it("l'étape RÉÉCRITURE est activée mais facultative (décision opérateur du 04/07/2026)", async () => {
    const manuscript = await createManuscriptAtCorrection("Manuscrit Réécriture Non Requise");

    const withoutFlag = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/CORRECTION/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(withoutFlag.statusCode).toBe(200);
    expect(withoutFlag.json().status).toBe("MISE_EN_PAGE");

    const manuscriptWithRewrite = await createManuscriptAtCorrection("Manuscrit Réécriture Requise");
    const withFlag = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscriptWithRewrite.id}/steps/CORRECTION/validate`,
      headers: { cookie: adminCookie },
      payload: { requires_rewrite: true },
    });
    expect(withFlag.statusCode).toBe(200);
    expect(withFlag.json().status).toBe("REECRITURE");

    const stored = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscriptWithRewrite.id } });
    expect(stored.requiresRewrite).toBe(true);
  });

  it("gère les partenaires par catégorie (auteur, correcteur, imprimeur...) sans refonte de structure", async () => {
    const printer = await app.inject({
      method: "POST",
      url: "/api/v1/partners",
      headers: { cookie: adminCookie },
      payload: { category: "imprimeur", first_name: "Presses", last_name: "du Sahel" },
    });
    expect(printer.statusCode).toBe(201);
    expect(printer.json().category).toBe("imprimeur");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/partners?category=imprimeur",
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    const partners = list.json();
    expect(partners.every((p: { category: string }) => p.category === "imprimeur")).toBe(true);
    expect(partners.some((p: { id: string }) => p.id === printer.json().id)).toBe(true);

    // Un contrat de prestation avec ce partenaire (pas un auteur) doit fonctionner.
    const contract = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: { type: "prestation", partner_id: printer.json().id, financial_terms: {} },
    });
    expect(contract.statusCode).toBe(201);
  });

  it("un point bloquant non résolu empêche la validation de l'étape CORRECTION", async () => {
    const manuscript = await createManuscriptAtCorrection("Manuscrit Avec Blocage");

    const taskResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/tasks`,
      headers: { cookie: adminCookie },
      payload: { title: "Correction", type: "correction_ortho", assignee_id: adminId },
    });
    const task = taskResponse.json();

    const commentResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: { cookie: adminCookie },
      payload: { body: "Incohérence à revoir", is_blocking: true },
    });
    const comment = commentResponse.json();

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/CORRECTION/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("blocking_comment_unresolved");

    await app.inject({ method: "PATCH", url: `/api/v1/task-comments/${comment.id}/resolve`, headers: { cookie: adminCookie } });

    const unblocked = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/steps/CORRECTION/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(unblocked.statusCode).toBe(200);
  });

  it("réplanifie une tâche et recalcule ses dépendantes, en signalant les conflits", async () => {
    const manuscript = await createManuscriptAtCorrection("Manuscrit Gantt");

    const taskAResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/tasks`,
      headers: { cookie: adminCookie },
      payload: { title: "A", type: "correction_ortho", planned_start: "2026-07-10", planned_end: "2026-07-15" },
    });
    const taskA = taskAResponse.json();

    const taskBResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/tasks`,
      headers: { cookie: adminCookie },
      payload: {
        title: "B",
        type: "layout",
        planned_start: "2026-07-16",
        planned_end: "2026-07-20",
        depends_on_task_id: taskA.id,
      },
    });
    const taskB = taskBResponse.json();
    await app.inject({ method: "PATCH", url: `/api/v1/tasks/${taskB.id}`, headers: { cookie: adminCookie }, payload: { status: "en_cours" } });

    const reschedule = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskA.id}/reschedule`,
      headers: { cookie: adminCookie },
      payload: { planned_start: "2026-07-20", planned_end: "2026-07-25", justification: "Retard" },
    });
    const result = reschedule.json();
    expect(result.cascaded).toHaveLength(1);
    expect(result.cascaded[0].id).toBe(taskB.id);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].task_id).toBe(taskB.id);
  });

  it("le comparateur détecte les ajouts et suppressions entre deux versions docx", async () => {
    const manuscript = await createManuscriptAtCorrection("Manuscrit Comparateur");
    const document = await prisma.document.create({
      data: { entityType: "manuscript", entityId: manuscript.id, category: "manuscrit", title: "Texte" },
    });

    const v1Buffer = await buildDocx(["Chapitre 1", "Il était une fois un prince."]);
    const v1Stored = await storeFile(v1Buffer, "v1.docx");
    const v1 = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 1,
        filePath: v1Stored.filePath,
        fileSize: v1Stored.fileSize,
        mimeType: DOCX_MIME,
        sha256Hash: v1Stored.sha256Hash,
      },
    });

    const v2Buffer = await buildDocx(["Chapitre 1", "Il était une fois une princesse.", "Chapitre 2", "La suite."]);
    const v2Stored = await storeFile(v2Buffer, "v2.docx");
    const v2 = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 2,
        filePath: v2Stored.filePath,
        fileSize: v2Stored.fileSize,
        mimeType: DOCX_MIME,
        sha256Hash: v2Stored.sha256Hash,
      },
    });

    const compareResponse = await app.inject({
      method: "POST",
      url: "/api/v1/document-versions/compare",
      headers: { cookie: adminCookie },
      payload: { left_id: v1.id, right_id: v2.id },
    });
    expect(compareResponse.statusCode).toBe(200);
    const report = compareResponse.json();
    expect(report.additions).toBeGreaterThan(0);
    expect(report.deletions).toBeGreaterThan(0);

    const archived = await prisma.document.findFirst({ where: { entityId: manuscript.id, category: "rapport_comparaison" } });
    expect(archived).not.toBeNull();
  });

  it("refuse la comparaison entre deux versions de documents différents", async () => {
    const docA = await prisma.document.create({ data: { entityType: "manuscript", entityId: "00000000-0000-0000-0000-000000000000", category: "manuscrit", title: "A" } });
    const docB = await prisma.document.create({ data: { entityType: "manuscript", entityId: "00000000-0000-0000-0000-000000000000", category: "manuscrit", title: "B" } });
    const stored = await storeFile(await buildDocx(["texte"]), "x.docx");
    const vA = await prisma.documentVersion.create({
      data: { documentId: docA.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: DOCX_MIME, sha256Hash: stored.sha256Hash },
    });
    const vB = await prisma.documentVersion.create({
      data: { documentId: docB.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: DOCX_MIME, sha256Hash: stored.sha256Hash },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/document-versions/compare",
      headers: { cookie: adminCookie },
      payload: { left_id: vA.id, right_id: vB.id },
    });
    expect(response.statusCode).toBe(409);
  });
});
