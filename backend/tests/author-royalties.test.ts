import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { authorRoyaltiesByYear } from "../src/lib/authorRoyalties.js";

// État annuel des droits d'auteur PAR AUTEUR : consolide les ouvrages d'un
// auteur sur une année (droits acquis + taux par livre) et le récapitulatif
// fiscal (versé brut, retenue à la source, net). Fenêtre isolée (année 2041)
// pour ne pas heurter les autres jeux de données.

const PWD = "Royalty123!";
const YEAR = 2041;
const rnd = () => Math.random().toString(36).slice(2, 8);

describe("états annuels de droits d'auteur par auteur", () => {
  let app: FastifyInstance;
  let partnerId: string;
  let contractA: string;
  let contractB: string;

  beforeAll(async () => {
    app = await buildApp();
    const partner = await prisma.partner.create({ data: { firstName: "Awa", lastName: `Ndiaye-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;

    const a = await prisma.contract.create({ data: { contractNumber: `CT-A-${rnd()}`, type: "edition", partnerId, financialTerms: {}, status: "active" } });
    const b = await prisma.contract.create({ data: { contractNumber: `CT-B-${rnd()}`, type: "edition", partnerId, financialTerms: {}, status: "active" } });
    contractA = a.id;
    contractB = b.id;

    const when = new Date(Date.UTC(YEAR, 5, 15));
    // Ouvrage A : 100 ex., base 5 000, taux 10 % → droits 50 000.
    await prisma.royaltyEntry.create({
      data: { contractId: contractA, sourceType: "pos_sale", sourceId: rnd(), quantity: 100, unitBaseAmount: "5000.00", rateApplied: "0.1000", amount: "50000.00", computedAt: when },
    });
    // Ouvrage B : 40 ex., base 5 000, taux 12 % → droits 24 000.
    await prisma.royaltyEntry.create({
      data: { contractId: contractB, sourceType: "pos_sale", sourceId: rnd(), quantity: 40, unitBaseAmount: "5000.00", rateApplied: "0.1200", amount: "24000.00", computedAt: when },
    });

    // Un relevé + un paiement dans l'année : versé net 45 000, retenue 5 000 (brut 50 000).
    const statement = await prisma.royaltyStatement.create({
      data: { contractId: contractA, periodStart: new Date(Date.UTC(YEAR, 0, 1)), periodEnd: new Date(Date.UTC(YEAR, 11, 31)), totalEarned: "50000.00", balanceDue: "50000.00", status: "issued" },
    });
    await prisma.royaltyPayment.create({
      data: { statementId: statement.id, partnerId, amount: "45000.00", taxWithheld: "5000.00", paidAt: new Date(Date.UTC(YEAR, 6, 1)) },
    });

    await createUserWithRole(`roy_mag_${rnd()}`, "MAGASINIER", PWD);
  });

  afterAll(async () => {
    await prisma.royaltyPayment.deleteMany({ where: { partnerId } });
    await prisma.royaltyStatement.deleteMany({ where: { contractId: { in: [contractA, contractB] } } });
    await prisma.royaltyEntry.deleteMany({ where: { contractId: { in: [contractA, contractB] } } });
    await prisma.contract.deleteMany({ where: { id: { in: [contractA, contractB] } } });
    await prisma.partner.delete({ where: { id: partnerId } });
    await app.close();
  });

  it("consolide par auteur : droits acquis par ouvrage (avec taux) + récap fiscal", async () => {
    const res = await authorRoyaltiesByYear({ year: YEAR, partnerId });
    const author = res.by_author.find((r) => r.partner_id === partnerId);
    expect(author).toBeTruthy();
    expect(author!.books).toHaveLength(2);
    // Droits acquis total = 50 000 + 24 000.
    expect(author!.earned).toBe(74000);
    // Détail par ouvrage, trié par droits décroissants : A (50 000, 10 %) puis B (24 000, 12 %).
    expect(author!.books[0]).toMatchObject({ units: 100, base: 500000, rate: 0.1, earned: 50000 });
    expect(author!.books[1]).toMatchObject({ units: 40, base: 200000, rate: 0.12, earned: 24000 });
    // Récapitulatif fiscal : brut 50 000, retenue 5 000, net 45 000.
    expect(author).toMatchObject({ paid_gross: 50000, tax_withheld: 5000, paid_net: 45000 });
  });

  it("une année sans droit renvoie l'auteur absent du résultat", async () => {
    const res = await authorRoyaltiesByYear({ year: YEAR + 5, partnerId });
    expect(res.by_author.find((r) => r.partner_id === partnerId)).toBeUndefined();
  });

  it("retenue à la source : réglage lu par défaut, écriture réservée à la DAF", async () => {
    const login = async (u: string, p: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
      return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    };
    await prisma.setting.deleteMany({ where: { key: "royalty_withholding_enabled" } }); // défaut = activée
    await createUserWithRole(`roy_daf_${rnd()}`, "RESP_FINANCE", PWD);
    const dafUser = await prisma.user.findFirst({ where: { username: { startsWith: "roy_daf_" } }, orderBy: { createdAt: "desc" } });
    const dafCookie = await login(dafUser!.username, PWD);
    const magUser = await prisma.user.findFirst({ where: { username: { startsWith: "roy_mag_" } }, orderBy: { createdAt: "desc" } });
    const magCookie = await login(magUser!.username, PWD);
    const adminCookie = await login("admin", process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!");

    // Lecture : activée par défaut.
    const read = await app.inject({ method: "GET", url: "/api/v1/royalties/withholding-enabled", headers: { cookie: adminCookie } });
    expect(read.statusCode).toBe(200);
    expect(read.json().enabled).toBe(true);

    // Écriture par un non-DAF : refusée.
    const denied = await app.inject({ method: "PUT", url: "/api/v1/royalties/withholding-enabled", headers: { cookie: magCookie }, payload: { enabled: false } });
    expect(denied.statusCode).toBe(403);

    // Écriture par la DAF : acceptée, valeur persistée.
    const set = await app.inject({ method: "PUT", url: "/api/v1/royalties/withholding-enabled", headers: { cookie: dafCookie }, payload: { enabled: false } });
    expect(set.statusCode).toBe(200);
    expect(set.json().enabled).toBe(false);
    const reread = await app.inject({ method: "GET", url: "/api/v1/royalties/withholding-enabled", headers: { cookie: dafCookie } });
    expect(reread.json().enabled).toBe(false);

    await prisma.setting.deleteMany({ where: { key: "royalty_withholding_enabled" } });
  });

  it("permissions : admin 200, magasinier 403 sur la vue par auteur", async () => {
    const login = async (u: string, p: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
      return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    };
    const adminCookie = await login("admin", process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!");
    const ok = await app.inject({ method: "GET", url: `/api/v1/royalties/by-author?year=${YEAR}`, headers: { cookie: adminCookie } });
    expect(ok.statusCode).toBe(200);

    const magUser = await prisma.user.findFirst({ where: { username: { startsWith: "roy_mag_" } }, orderBy: { createdAt: "desc" } });
    const magCookie = await login(magUser!.username, PWD);
    const denied = await app.inject({ method: "GET", url: `/api/v1/royalties/by-author?year=${YEAR}`, headers: { cookie: magCookie } });
    expect(denied.statusCode).toBe(403);
  });
});
