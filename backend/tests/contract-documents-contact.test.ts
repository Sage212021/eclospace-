import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Demande opérateur du 02/08/2026 (page Contrats) :
//  - téléverser le contrat physique signé scanné (PDF/images) ;
//  - coordonnées de l'auteur (e-mail + WhatsApp) pour les notifications ;
//  - traçabilité : qui a saisi / modifié.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Construit un corps multipart minimal (un champ fichier + champs texte).
function multipart(parts: { fields?: Record<string, string>; fileField: string; fileName: string; mime: string; content: Buffer }) {
  const boundary = `----ecl${rnd()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(parts.fields ?? {})) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${parts.fileField}"; filename="${parts.fileName}"\r\nContent-Type: ${parts.mime}\r\n\r\n`,
    ),
  );
  chunks.push(parts.content);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Contrats — pièces signées, coordonnées auteur, traçabilité", () => {
  let app: FastifyInstance;
  let cookie: string;
  let partnerId: string;
  let contractId: string;
  const docIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const partner = await prisma.partner.create({ data: { firstName: "Awa", lastName: `Nkeng-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie },
      payload: { type: "edition", partner_id: partnerId, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });
    contractId = res.json().id;
  });

  afterAll(async () => {
    await prisma.contractDocument.deleteMany({ where: { contractId } });
    await prisma.royaltyTerms.deleteMany({ where: { contractId } });
    await prisma.contract.deleteMany({ where: { id: contractId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await app.close();
  });

  it("enregistre l'e-mail et le WhatsApp de l'auteur", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/partners/${partnerId}`,
      headers: { cookie },
      payload: { email: "awa@example.com", whatsapp: "+237600000000" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe("awa@example.com");
    expect(res.json().whatsapp).toBe("+237600000000");
  });

  it("refuse un e-mail invalide", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/partners/${partnerId}`,
      headers: { cookie },
      payload: { email: "pas-un-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("téléverse le contrat signé scanné (PDF) et le liste", async () => {
    const mp = multipart({
      fields: { label: "Contrat signé", kind: "signed_scan" },
      fileField: "file",
      fileName: "contrat.pdf",
      mime: "application/pdf",
      content: Buffer.from("%PDF-1.4 fake scan"),
    });
    const up = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/documents`,
      headers: { cookie, "content-type": mp.contentType },
      payload: mp.body,
    });
    expect(up.statusCode).toBe(201);
    expect(up.json().kind).toBe("signed_scan");
    expect(up.json().name).toBe("contrat.pdf");
    docIds.push(up.json().id);

    const list = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/documents`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBe(1);
    expect(list.json()[0].uploaded_by).toBeTruthy();
  });

  it("télécharge puis retire la pièce (suppression logique)", async () => {
    const dl = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/documents/${docIds[0]}/download`, headers: { cookie } });
    expect(dl.statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: `/api/v1/contracts/${contractId}/documents/${docIds[0]}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    // La ligne existe toujours en base, marquée supprimée (append-only / conservation).
    const row = await prisma.contractDocument.findUnique({ where: { id: docIds[0] } });
    expect(row?.deletedAt).not.toBeNull();

    const list = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/documents`, headers: { cookie } });
    expect(list.json().length).toBe(0);
  });

  it("expose la traçabilité du contrat (saisi par)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().createdByName).toBeTruthy();
  });
});
