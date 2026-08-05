import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Garde anti-doublon (demande opérateur du 02/08/2026) : un même ouvrage ne peut
// pas recevoir deux fois le même contrat (même partenaire + même type) tant qu'il
// est actif. Les contrats différents restent autorisés.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Contrat — pas de doublon sur un même ouvrage", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId: string;
  let partnerA: string;
  let partnerB: string;
  const contractIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));

    const status = await prisma.workflowStatus.findFirst();
    const admin = await prisma.user.findFirst({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: {
        manuscriptNumber: `MS-DUP-${rnd()}`,
        title: `Ouvrage doublon ${rnd()}`,
        statusId: status!.id,
        ownerId: admin!.id,
        origin: "soumission",
        language: "fr",
        receivedAt: new Date(),
      },
    });
    manuscriptId = m.id;
    partnerA = (await prisma.partner.create({ data: { firstName: "Ada", lastName: `Ngo-${rnd()}`, category: "auteur" } })).id;
    partnerB = (await prisma.partner.create({ data: { firstName: "Bala", lastName: `Sow-${rnd()}`, category: "traducteur" } })).id;
  });

  afterAll(async () => {
    await prisma.royaltyTerms.deleteMany({ where: { contract: { manuscriptId } } });
    await prisma.contract.deleteMany({ where: { manuscriptId } });
    await prisma.partner.deleteMany({ where: { id: { in: [partnerA, partnerB] } } });
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } });
    await app.close();
  });

  const create = (partner_id: string, type: string) =>
    app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie },
      payload: { type, manuscript_id: manuscriptId, partner_id, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });

  it("accepte le premier contrat d'édition", async () => {
    const res = await create(partnerA, "edition");
    expect(res.statusCode).toBe(201);
    contractIds.push(res.json().id);
  });

  it("refuse un second contrat identique (même auteur + même type)", async () => {
    const res = await create(partnerA, "edition");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("contract_duplicate");
    expect(res.json().existing_contract_number).toBeTruthy();
  });

  it("autorise un type différent sur le même ouvrage (traduction)", async () => {
    const res = await create(partnerB, "traduction");
    expect(res.statusCode).toBe(201);
    contractIds.push(res.json().id);
  });

  it("réautorise après résiliation du contrat existant", async () => {
    // Rendre le contrat d'édition « résilié » puis retenter : le doublon est levé.
    await prisma.contract.update({ where: { id: contractIds[0] }, data: { status: "terminated" } });
    const res = await create(partnerA, "edition");
    expect(res.statusCode).toBe(201);
    contractIds.push(res.json().id);
  });

  // Nuance format (Ch. 9 §9.5) : papier et numérique sont deux contrats
  // légitimes sur le même ouvrage, même partenaire, même type — leurs formats
  // étant disjoints, ce ne sont pas des doublons. Formats qui se chevauchent = doublon.
  it("autorise des contrats de formats disjoints (papier puis numérique)", async () => {
    const partnerC = (await prisma.partner.create({ data: { firstName: "Cora", lastName: `Eto-${rnd()}`, category: "auteur" } })).id;
    const withFormats = (formats: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/v1/contracts",
        headers: { cookie },
        payload: { type: "edition", manuscript_id: manuscriptId, partner_id: partnerC, formats, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
      });

    const print = await withFormats(["print"]);
    expect(print.statusCode).toBe(201);
    const epub = await withFormats(["epub"]);
    expect(epub.statusCode).toBe(201); // formats disjoints : autorisé

    const printAgain = await withFormats(["print", "audio"]);
    expect(printAgain.statusCode).toBe(409); // « print » chevauche : doublon
    expect(printAgain.json().code).toBe("contract_duplicate");
  });
});
