import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Réouverture EXCEPTIONNELLE d'une paie verrouillée (ch. 23) : le RH demande, le
// DG autorise, le mois repasse en brouillon (puis refait le circuit normal).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2035-06";

describe("réouverture exceptionnelle (demande RH → décision DG)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let emp: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));

    const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: PERIOD } });
    if (run) {
      await prisma.payrollMonthlyLine.deleteMany({ where: { runId: run.id } });
      await prisma.payrollReopenRequest.deleteMany({ where: { periodKey: PERIOD } });
      await prisma.payrollMonthlyRun.delete({ where: { id: run.id } });
    }
    if (!(await prisma.payrollRateSet.findFirst({ where: { effectiveFrom: new Date("2035-01-01T00:00:00.000Z") } }))) {
      await prisma.payrollRateSet.create({
        data: {
          effectiveFrom: new Date("2035-01-01T00:00:00.000Z"), label: "Barème réouverture",
          vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
          abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
          coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
          irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
          irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
          tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
        },
      });
    }
    const e = await prisma.employee.create({ data: { firstName: "Réouv", lastName: "Test", status: "salarie" } });
    emp = e.id;
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${emp}/profile`, headers: { cookie },
      payload: { gross_contractual: 300000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false, cnps_number: "X", niu: "Y", matricule: "M1" },
    });
    // Mois isolé à ce seul salarié (base de test partagée), puis soumis + validé.
    const created = await prisma.payrollMonthlyRun.create({ data: { periodKey: PERIOD } });
    await prisma.payrollMonthlyLine.create({ data: { runId: created.id, employeeId: emp } });
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/validate`, headers: { cookie } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("le mois est verrouillé : la saisie directe est refusée", async () => {
    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp}`, headers: { cookie },
      payload: { primes: 1, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().code).toBe("run_locked");
  });

  it("le RH demande la réouverture ; le DG autorise ; le mois redevient modifiable", async () => {
    const req = await app.inject({
      method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/reopen-request`, headers: { cookie },
      payload: { employee_id: emp, element: "Salaire de base", old_value: "300000", requested_correction: "320000", reason: "Erreur de saisie" },
    });
    expect(req.statusCode).toBe(201);

    const list = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}/reopen-requests`, headers: { cookie } })).json();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("en_attente");
    const id = list[0].id;

    const decide = await app.inject({ method: "POST", url: `/api/v1/payroll/reopen-requests/${id}/decide`, headers: { cookie }, payload: { decision: "autorisee" } });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().run_status).toBe("brouillon");

    // Redevenue modifiable.
    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp}`, headers: { cookie },
      payload: { primes: 5000, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch.statusCode).toBe(200);
  });

  it("une demande de réouverture sur un mois non verrouillé est refusée", async () => {
    // Le mois est en brouillon depuis le test précédent.
    const req = await app.inject({
      method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/reopen-request`, headers: { cookie },
      payload: { element: "Prime", requested_correction: "aucune", reason: "test réouverture" },
    });
    expect(req.statusCode).toBe(409);
    expect(req.json().code).toBe("not_locked");
  });
});
