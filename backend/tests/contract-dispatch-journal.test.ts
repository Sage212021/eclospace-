import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Journal d'envoi du contrat : chaque transmission à l'auteur (messagerie
// interne / WhatsApp) est tracée (preuve d'envoi), append-only, journalisée à
// l'audit. Consultation ouverte à qui voit les contrats ; enregistrement réservé
// à la saisie des contrats.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("journal d'envoi du contrat", () => {
  let app: FastifyInstance;
  let cookie: string;
  let partnerId: string;
  let contractId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    const partner = await prisma.partner.create({ data: { firstName: "Dispatch", lastName: `Auteur-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;
    const res = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: { type: "edition", partner_id: partnerId, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });
    expect(res.statusCode).toBe(201);
    contractId = res.json().id;
  });

  afterAll(async () => {
    await prisma.contractDispatch.deleteMany({ where: { contractId } });
    await prisma.royaltyTerms.deleteMany({ where: { contractId } });
    await prisma.contract.deleteMany({ where: { partnerId } });
    await prisma.partner.delete({ where: { id: partnerId } }).catch(() => {});
    await app.close();
  });

  it("enregistre un envoi, l'expose dans le journal et le trace à l'audit", async () => {
    const rec = await app.inject({
      method: "POST", url: `/api/v1/contracts/${contractId}/dispatches`, headers: { cookie },
      payload: { channel: "whatsapp", document_label: "Contrat d'édition CTR-TEST", recipient: "+237699000000", note: "À signer SVP" },
    });
    expect(rec.statusCode).toBe(201);
    const created = rec.json();
    expect(created.channel).toBe("whatsapp");
    expect(created.recipient).toBe("+237699000000");
    expect(created.sent_by_name).not.toBeNull();

    const list = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/dispatches`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const rows = list.json() as Array<{ id: string; channel: string; note: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("whatsapp");
    expect(rows[0].note).toBe("À signer SVP");

    // Un second envoi s'ajoute (append-only), le plus récent en tête.
    await app.inject({
      method: "POST", url: `/api/v1/contracts/${contractId}/dispatches`, headers: { cookie },
      payload: { channel: "messagerie_interne", document_label: "Contrat d'édition CTR-TEST", recipient: "DG" },
    });
    const list2 = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/dispatches`, headers: { cookie } });
    const rows2 = list2.json() as Array<{ channel: string }>;
    expect(rows2).toHaveLength(2);
    expect(rows2[0].channel).toBe("messagerie_interne"); // tri antéchronologique

    // Trace au journal d'audit.
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "contract_dispatch", entityId: created.id } });
    expect(audit).not.toBeNull();
  });

  it("inclut le journal d'envoi dans le détail du contrat", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { dispatches: unknown[] };
    expect(Array.isArray(body.dispatches)).toBe(true);
    expect(body.dispatches.length).toBeGreaterThanOrEqual(2);
  });

  it("refuse l'enregistrement d'un canal invalide (400)", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/v1/contracts/${contractId}/dispatches`, headers: { cookie },
      payload: { channel: "pigeon_voyageur", document_label: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("interdit l'enregistrement à un profil sans droit de saisie contrats (403)", async () => {
    const s = rnd();
    await createUserWithRole(`lecteur_${s}`, "RESP_RH", "Lecteur123!");
    const readerCookie = await login(`lecteur_${s}`, "Lecteur123!");
    const res = await app.inject({
      method: "POST", url: `/api/v1/contracts/${contractId}/dispatches`, headers: { cookie: readerCookie },
      payload: { channel: "whatsapp", document_label: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});
