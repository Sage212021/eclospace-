import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Niveau 1 de l'exploitation du document fiscal (21/08/2026) : catalogue des
// éléments de salaire (statut fiscal/CNPS) + barème des avantages en nature
// versionné avec le reste du barème.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("catalogue des éléments de salaire (fiscal / CNPS)", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    // Restaure le statut modifié pour ne pas contaminer les autres suites.
    await app.inject({ method: "PATCH", url: "/api/v1/payroll/salary-elements/prime_transport", headers: { cookie }, payload: { fiscal_status: "non_taxable" } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("liste la classification (base taxable+cotisable ; représentation exonérée+non cotisable)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payroll/salary-elements", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const els = res.json().elements as { code: string; fiscal_status: string; cnps_status: string }[];
    const base = els.find((e) => e.code === "salaire_base");
    expect(base).toMatchObject({ fiscal_status: "taxable", cnps_status: "cotisable" });
    const repr = els.find((e) => e.code === "indemnite_representation");
    expect(repr).toMatchObject({ fiscal_status: "non_taxable", cnps_status: "non_cotisable" });
    const preavis = els.find((e) => e.code === "indemnite_preavis");
    expect(preavis).toMatchObject({ fiscal_status: "taxable", cnps_status: "cotisable" });
  });

  it("un administrateur peut ajuster un statut (tracé)", async () => {
    const put = await app.inject({ method: "PATCH", url: "/api/v1/payroll/salary-elements/prime_transport", headers: { cookie }, payload: { fiscal_status: "partiel" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().fiscal_status).toBe("partiel");
    const back = await prisma.salaryElement.findUniqueOrThrow({ where: { code: "prime_transport" } });
    expect(back.fiscalStatus).toBe("partiel");
  });

  it("le barème des avantages en nature est exposé et versionné (défauts légaux)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payroll/rate-set", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().avantages_nature).toMatchObject({ logement: 0.15, electricite: 0.04, eau: 0.02, domestique: 0.05, vehicule: 0.1, nourriture: 0.1 });
  });
});
