import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

// Contractualisation « chez le DG » (demande opérateur 16/10) : après la
// contre-validation du BAT, l'ouvrage passe à la contractualisation. Le DG
// établit/fait signer le contrat et dépose le scan signé des deux parties, puis
// valide (clic final réservé au DG) → l'impression est alors autorisée. Le DG
// peut déléguer la PRÉPARATION (Éditorial, RH, DAF).
describe("Contractualisation chez le DG", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let dgCookie: string;
  let editorialCookie: string;
  let rhCookie: string;
  let rhId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;

    await createUserWithRole("dg_contract", "DIR_GENERAL", "DirContract123!");
    await createUserWithRole("editorial_contract", "DIR_EDITORIAL", "EdContract123!");
    const rh = await createUserWithRole("rh_contract", "RESP_RH", "RhContract123!");
    rhId = rh.id;
    dgCookie = await loginCookie(app, "dg_contract", "DirContract123!");
    editorialCookie = await loginCookie(app, "editorial_contract", "EdContract123!");
    rhCookie = await loginCookie(app, "rh_contract", "RhContract123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Manuscrit à l'étape CONTRACTUALISATION, avec un contrat en préparation.
  async function manuscriptAtContractualisation(baseTitle: string) {
    const title = `${baseTitle} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const manuscript = (
      await app.inject({
        method: "POST",
        url: "/api/v1/manuscripts",
        headers: { cookie: adminCookie },
        payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } },
      })
    ).json();
    if (!manuscript?.id) throw new Error(`manuscript create failed: ${JSON.stringify(manuscript).slice(0, 200)}`);
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contract = (
      await app.inject({
        method: "POST",
        url: "/api/v1/contracts",
        headers: { cookie: adminCookie },
        payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} },
      })
    ).json();
    const cs = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CONTRACTUALISATION" } });
    await prisma.manuscript.update({ where: { id: manuscript.id }, data: { statusId: cs.id } });
    return { manuscriptId: manuscript.id as string, contractId: contract.id as string, partnerId };
  }

  async function depositSignedScan(contractId: string) {
    await prisma.contractDocument.create({
      data: { contractId, kind: "signed_scan", label: "Contrat signé", fileName: "contrat-signe.pdf", filePath: `test/contrat-${contractId}.pdf`, fileMime: "application/pdf", fileSize: 1234 },
    });
  }

  it("refuse la validation de la contractualisation tant que le contrat signé (scan) n'est pas déposé", async () => {
    const { manuscriptId } = await manuscriptAtContractualisation("Contrat Sans Scan");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/steps/CONTRACTUALISATION/validate`, headers: { cookie: dgCookie }, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("contract_signed_scan_required");
  });

  it("réserve le clic final au DG : un directeur éditorial (manuscripts:validation) est refusé", async () => {
    const { manuscriptId, contractId } = await manuscriptAtContractualisation("Contrat Clic Editorial");
    await depositSignedScan(contractId);
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/steps/CONTRACTUALISATION/validate`, headers: { cookie: editorialCookie }, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });

  it("le DG valide la contractualisation une fois le scan signé déposé : l'ouvrage passe à l'impression", async () => {
    const { manuscriptId, contractId } = await manuscriptAtContractualisation("Contrat DG Valide");
    await depositSignedScan(contractId);
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/steps/CONTRACTUALISATION/validate`, headers: { cookie: dgCookie }, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().advanced).toBe(true);
    expect(res.json().status).toBe("IMPRESSION");
  });

  it("délègue la préparation au RH (rôle délégable) et notifie le délégué", async () => {
    const { manuscriptId } = await manuscriptAtContractualisation("Contrat Delegation RH");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/contractualisation/delegate`, headers: { cookie: dgCookie }, payload: { assignee_id: rhId } });
    expect(res.statusCode).toBe(200);
    expect(res.json().delegated_to).toBe(rhId);
    const notif = await prisma.notification.findFirst({ where: { userId: rhId, entityId: manuscriptId, title: { startsWith: "Contractualisation déléguée" } } });
    expect(notif).not.toBeNull();
  });

  it("refuse la délégation à un rôle non délégable (ex. infographe)", async () => {
    const info = await createUserWithRole("info_contract", "RESP_INFOGRAPHIE", "InfoContract123!");
    const { manuscriptId } = await manuscriptAtContractualisation("Contrat Delegation Refus");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/contractualisation/delegate`, headers: { cookie: dgCookie }, payload: { assignee_id: info.id } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("role_not_delegable");
  });

  it("accès scopé : le délégué (sans droit contrats) peut préparer le contrat de SON dossier, pas d'un autre", async () => {
    // Dossier délégué au RH : il peut modifier les termes du contrat.
    const mine = await manuscriptAtContractualisation("Contrat Scope Mine");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${mine.manuscriptId}/contractualisation/delegate`, headers: { cookie: dgCookie }, payload: { assignee_id: rhId } });
    const ok = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${mine.contractId}/terms`, headers: { cookie: rhCookie }, payload: { rate: 0.1 } });
    expect(ok.statusCode).toBe(200);

    // Autre dossier NON délégué au RH : accès refusé.
    const other = await manuscriptAtContractualisation("Contrat Scope Other");
    const denied = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${other.contractId}/terms`, headers: { cookie: rhCookie }, payload: { rate: 0.1 } });
    expect(denied.statusCode).toBe(403);
  });

  it("inbox : le DG voit les dossiers ; le délégué ne voit que les siens ; un tiers est refusé", async () => {
    const mine = await manuscriptAtContractualisation("Contrat Inbox Mine");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${mine.manuscriptId}/contractualisation/delegate`, headers: { cookie: dgCookie }, payload: { assignee_id: rhId } });

    const dgInbox = await app.inject({ method: "GET", url: "/api/v1/contractualisation/inbox", headers: { cookie: dgCookie } });
    expect(dgInbox.statusCode).toBe(200);
    expect(dgInbox.json().is_direction).toBe(true);
    expect(dgInbox.json().items.some((i: { manuscript_id: string }) => i.manuscript_id === mine.manuscriptId)).toBe(true);

    const rhInbox = await app.inject({ method: "GET", url: "/api/v1/contractualisation/inbox", headers: { cookie: rhCookie } });
    expect(rhInbox.statusCode).toBe(200);
    expect(rhInbox.json().is_direction).toBe(false);
    expect(rhInbox.json().items.every((i: { delegate: { id: string } | null }) => i.delegate?.id === rhId)).toBe(true);
    expect(rhInbox.json().items.some((i: { manuscript_id: string }) => i.manuscript_id === mine.manuscriptId)).toBe(true);

    // Un tiers (ni DG, ni délégué d'aucun dossier) est refusé proprement.
    await createUserWithRole("info_inbox", "RESP_INFOGRAPHIE", "InfoInbox123!");
    const infoCookie = await loginCookie(app, "info_inbox", "InfoInbox123!");
    const thirdParty = await app.inject({ method: "GET", url: "/api/v1/contractualisation/inbox", headers: { cookie: infoCookie } });
    expect(thirdParty.statusCode).toBe(403);
  });
});
