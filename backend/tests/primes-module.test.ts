import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Module « Primes du mois » (demande opérateur 09/09/2026) : ajout / liste /
// modification / suppression tant que « à valider », validation (intégration
// automatique à la paie du mois, source unique du champ primes), annulation, et
// refus de validation si la paie du mois est verrouillée.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Module Primes du mois", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));

    const emp = await prisma.employee.create({ data: { firstName: "Prime", lastName: "Salarié" } });
    employeeId = emp.id;
    // Fiche paie + barème pour la période d'intégration (2032-03).
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/profile`, headers: { cookie },
      payload: { gross_contractual: 400000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2032-01-01T00:00:00.000Z"), label: "Barème primes test",
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });
  });

  afterAll(async () => {
    await prisma.prime.deleteMany({ where: { employeeId } });
    await app.close();
    await prisma.$disconnect();
  });

  const create = (period: string, amount: number, type = "rendement") =>
    app.inject({ method: "POST", url: "/api/v1/primes", headers: { cookie }, payload: { employee_id: employeeId, period, type, amount, motif: "Objectifs atteints" } });

  it("ajoute une prime « à valider », la liste, la modifie puis la supprime", async () => {
    const c = await create("2032-08", 20000);
    expect(c.statusCode).toBe(201);
    const prime = c.json();
    expect(prime.status).toBe("a_valider");
    expect(prime.employee_name).toBe("Prime Salarié");

    const list = (await app.inject({ method: "GET", url: "/api/v1/primes?period=2032-08", headers: { cookie } })).json() as Array<{ id: string; amount: number }>;
    expect(list.find((p) => p.id === prime.id)!.amount).toBe(20000);

    const edit = await app.inject({ method: "PATCH", url: `/api/v1/primes/${prime.id}`, headers: { cookie }, payload: { amount: 25000, type: "transport" } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().amount).toBe(25000);
    expect(edit.json().type).toBe("transport");

    const del = await app.inject({ method: "DELETE", url: `/api/v1/primes/${prime.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    const after = (await app.inject({ method: "GET", url: "/api/v1/primes?period=2032-08", headers: { cookie } })).json() as Array<{ id: string }>;
    expect(after.find((p) => p.id === prime.id)).toBeUndefined();
  });

  it("une prime validée n'est plus modifiable ni supprimable, mais peut être annulée", async () => {
    const prime = (await create("2032-09", 30000)).json();
    const val = await app.inject({ method: "POST", url: `/api/v1/primes/${prime.id}/validate`, headers: { cookie } });
    expect(val.statusCode).toBe(200);
    expect(val.json().status).toBe("validee");

    expect((await app.inject({ method: "PATCH", url: `/api/v1/primes/${prime.id}`, headers: { cookie }, payload: { amount: 1 } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/primes/${prime.id}`, headers: { cookie } })).statusCode).toBe(409);

    const cancel = await app.inject({ method: "POST", url: `/api/v1/primes/${prime.id}/cancel`, headers: { cookie } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("annulee");
  });

  it("valider une prime l'intègre automatiquement à la ligne de paie du mois", async () => {
    const PERIOD = "2032-03";
    // Prépare le mois (crée la ligne du salarié, primes = 0 au départ).
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    const run = await prisma.payrollMonthlyRun.findUniqueOrThrow({ where: { periodKey: PERIOD } });
    const before = await prisma.payrollMonthlyLine.findUniqueOrThrow({ where: { runId_employeeId: { runId: run.id, employeeId } } });
    expect(Number(before.primes)).toBe(0);

    // Deux primes validées (transport 20 000 + rendement 30 000 = 50 000).
    const p1 = (await create(PERIOD, 20000, "transport")).json();
    const p2 = (await create(PERIOD, 30000, "rendement")).json();
    await app.inject({ method: "POST", url: `/api/v1/primes/${p1.id}/validate`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/v1/primes/${p2.id}/validate`, headers: { cookie } });

    const line = await prisma.payrollMonthlyLine.findUniqueOrThrow({ where: { runId_employeeId: { runId: run.id, employeeId } } });
    expect(Number(line.primes)).toBe(50000);

    // Annuler une prime la retire du total intégré.
    await app.inject({ method: "POST", url: `/api/v1/primes/${p1.id}/cancel`, headers: { cookie } });
    const line2 = await prisma.payrollMonthlyLine.findUniqueOrThrow({ where: { runId_employeeId: { runId: run.id, employeeId } } });
    expect(Number(line2.primes)).toBe(30000);
  });

  it("refuse de valider une prime si la paie du mois est verrouillée (soumise/validée)", async () => {
    const PERIOD = "2032-04";
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    // On verrouille le mois (soumis au DG) directement.
    await prisma.payrollMonthlyRun.update({ where: { periodKey: PERIOD }, data: { status: "soumis_dg" } });

    const prime = (await create(PERIOD, 15000)).json();
    const val = await app.inject({ method: "POST", url: `/api/v1/primes/${prime.id}/validate`, headers: { cookie } });
    expect(val.statusCode).toBe(409);
    expect(val.json().code).toBe("run_locked");
  });
});
