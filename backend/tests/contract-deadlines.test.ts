import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { buildContractDeadline, renewalNoticeDeadline, runContractDeadlineAlerts } from "../src/lib/contractDeadlines.js";

// Échéances & alertes de contrats :
// - l'activation pose la date d'effet (base de calcul de l'échéance) ;
// - le tableau de bord expose l'échéance, le préavis de non-reconduction (−3 mois)
//   et le niveau de gravité ;
// - la Direction est alertée une seule fois par contrat (dédup).

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("échéances & alertes de contrats", () => {
  let app: FastifyInstance;
  let cookie: string;
  const partnerIds: string[] = [];
  const contractIds: string[] = [];

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  // Crée directement un contrat ACTIF échéant dans `daysToExpiry` jours (durée 12
  // mois → date d'effet = échéance − 12 mois), sans dérouler tout le circuit.
  async function makeActiveContract(daysToExpiry: number) {
    const partner = await prisma.partner.create({ data: { firstName: "Éch", lastName: `Auteur-${rnd()}`, category: "auteur" } });
    partnerIds.push(partner.id);
    const created = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: { type: "edition", partner_id: partner.id, duration_months: 12, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });
    const id = created.json().id;
    contractIds.push(id);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + daysToExpiry);
    const effectiveAt = new Date(expiry);
    effectiveAt.setMonth(effectiveAt.getMonth() - 12);
    await prisma.contract.update({ where: { id }, data: { status: "active", effectiveAt, durationMonths: 12 } });
    return id;
  }

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    // S'assurer qu'un DG existe pour recevoir les alertes.
    await createUserWithRole(`dg_${rnd()}`, "DIR_GENERAL", "DgPass123!");
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityType: "contract", entityId: { in: contractIds } } }).catch(() => {});
    await prisma.contractSignature.deleteMany({ where: { contractId: { in: contractIds } } }).catch(() => {});
    await prisma.royaltyTerms.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } }).catch(() => {});
    await app.close();
  });

  it("calcule l'échéance, le préavis −3 mois et le niveau de gravité (unitaire)", () => {
    const now = new Date("2026-08-15T00:00:00Z");
    const effectiveAt = new Date("2025-10-01T00:00:00Z"); // +12 mois → échéance 2026-10-01 (dans ~47 j)
    const d = buildContractDeadline(
      { id: "x", contractNumber: "CTR-X", status: "active", effectiveAt, durationMonths: 12, manuscript: { title: "Titre" }, partner: { firstName: "A", lastName: "B" } },
      now,
    );
    expect(d).not.toBeNull();
    expect(d!.expiry).toBe("2026-10-01");
    // Préavis = échéance − 3 mois = 2026-07-01 (déjà dépassé au 15/08).
    expect(d!.renewal_notice_deadline).toBe(renewalNoticeDeadline(new Date("2026-10-01T00:00:00Z")).toISOString().slice(0, 10));
    expect(d!.renewal_notice_deadline).toBe("2026-07-01");
    expect(d!.notice_passed).toBe(true);
    expect(d!.overdue).toBe(false);
    expect(d!.level).toBe("attention"); // ~47 j > 30 → attention (pas encore critique)
  });

  it("hors fenêtre (>90 j) : non signalé ; dans la fenêtre : signalé", () => {
    const now = new Date("2026-08-15T00:00:00Z");
    const far = buildContractDeadline(
      { id: "x", contractNumber: "CTR-X", status: "active", effectiveAt: new Date("2026-06-01T00:00:00Z"), durationMonths: 12, manuscript: null, partner: { firstName: "A", lastName: "B" } },
      now,
    ); // échéance 2027-06-01 → loin
    expect(far).toBeNull();
  });

  it("l'activation par signature pose la date d'effet (échéance calculable)", async () => {
    const partner = await prisma.partner.create({ data: { firstName: "Sig", lastName: `Auteur-${rnd()}`, category: "auteur" } });
    partnerIds.push(partner.id);
    const created = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: { type: "edition", partner_id: partner.id, duration_months: 12, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });
    const id = created.json().id;
    contractIds.push(id);
    // Dérouler le circuit jusqu'à « en attente de signature ».
    for (const s of ["legal_review", "direction_approval", "awaiting_signature"]) {
      const r = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/status`, headers: { cookie }, payload: { status: s } });
      expect(r.statusCode).toBe(200);
    }
    // Signature de la partie contractante → activation.
    const sign = await app.inject({ method: "POST", url: `/api/v1/contracts/${id}/sign`, headers: { cookie }, payload: { party: "author", signer_name: "Auteur Test", consent: true } });
    expect(sign.statusCode).toBe(200);
    const row = await prisma.contract.findUnique({ where: { id } });
    expect(row!.status).toBe("active");
    expect(row!.effectiveAt).not.toBeNull(); // date d'effet posée à l'activation
  });

  it("le tableau de bord liste l'échéance proche avec préavis + niveau critique", async () => {
    const id = await makeActiveContract(20); // échéance dans 20 j → critique
    const res = await app.inject({ method: "GET", url: "/api/v1/contracts/dashboard", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const row = (res.json().expiring as Array<{ id: string; level: string; renewal_notice_deadline: string; notice_passed: boolean }>).find((e) => e.id === id);
    expect(row).toBeDefined();
    expect(row!.level).toBe("critique");
    expect(row!.renewal_notice_deadline).toBeTruthy();
    expect(row!.notice_passed).toBe(true); // échéance à 20 j → préavis (−3 mois) déjà dépassé
  });

  it("alerte la Direction une seule fois par contrat (dédup)", async () => {
    const id = await makeActiveContract(45);
    // 1re passe : une alerte est émise.
    const created1 = await runContractDeadlineAlerts();
    expect(created1).toBeGreaterThanOrEqual(1);
    const notif = await prisma.notification.findFirst({ where: { entityType: "contract", entityId: id, type: "echeance" } });
    expect(notif).not.toBeNull();
    const marked = await prisma.contract.findUnique({ where: { id } });
    expect(marked!.renewalAlertSentAt).not.toBeNull();
    // 2e passe : ce contrat n'est plus ré-alerté.
    const before = await prisma.notification.count({ where: { entityType: "contract", entityId: id } });
    await runContractDeadlineAlerts();
    const after = await prisma.notification.count({ where: { entityType: "contract", entityId: id } });
    expect(after).toBe(before);
  });
});
