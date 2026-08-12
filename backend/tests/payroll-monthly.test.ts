import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Cycle mensuel de paie (chantier 07/08/2026) — Étape 1 : préparation du mois
// pour tous les salariés, grille éditable, net recalculé, brouillon verrouillé
// une fois validé.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2031-05"; // période dédiée (DB de test partagée)

describe("génération mensuelle de la paie (grille éditable)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let emp1: string;
  let emp2: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));

    // Repartir propre sur la période dédiée.
    const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: PERIOD } });
    if (run) {
      await prisma.payrollMonthlyLine.deleteMany({ where: { runId: run.id } });
      await prisma.payrollMonthlyRun.delete({ where: { id: run.id } });
    }

    await prisma.payrollRateSet.create({
      data: {
        // Date dédiée à cette période (≤ 2031-05, postérieure aux barèmes des
        // autres fichiers de test) → sélection déterministe malgré la DB partagée.
        effectiveFrom: new Date("2031-01-01T00:00:00.000Z"), label: "Barème mensuel test",
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });

    const e1 = await prisma.employee.create({ data: { firstName: "Mensuel", lastName: "Alpha" } });
    const e2 = await prisma.employee.create({ data: { firstName: "Mensuel", lastName: "Beta" } });
    emp1 = e1.id;
    emp2 = e2.id;
    for (const id of [emp1, emp2]) {
      await app.inject({
        method: "PUT", url: `/api/v1/payroll/employees/${id}/profile`, headers: { cookie },
        payload: { gross_contractual: 400000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("prépare le mois pour tous les salariés dotés d'une fiche (idempotent)", async () => {
    const r1 = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().status).toBe("brouillon");
    // Idempotent : re-préparer ne duplique pas.
    const r2 = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    expect(r2.statusCode).toBe(200);

    const run = await prisma.payrollMonthlyRun.findUniqueOrThrow({ where: { periodKey: PERIOD } });
    const count = await prisma.payrollMonthlyLine.count({ where: { runId: run.id } });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("calcule le net de chaque salarié et met à jour après saisie d'une prime", async () => {
    const before = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}`, headers: { cookie } })).json();
    expect(before.exists).toBe(true);
    // Taux d'affichage du bulletin (colonne « Taux » du modèle moteur) exposés
    // pour le rendu du bulletin — même barème que le calcul.
    expect(before.rates.vid_sal).toBeCloseTo(0.042);
    expect(before.rates.cac).toBeCloseTo(0.1);
    const l1 = before.lines.find((l: { employee_id: string }) => l.employee_id === emp1);
    expect(l1.net_a_payer).toBeGreaterThan(0);

    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp1}`, headers: { cookie },
      payload: { primes: 100000, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch.statusCode).toBe(200);

    const after = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}`, headers: { cookie } })).json();
    const l1b = after.lines.find((l: { employee_id: string }) => l.employee_id === emp1);
    expect(l1b.net_a_payer).toBeGreaterThan(l1.net_a_payer);
    // Une avance (retenue nette) diminue le net.
    const avance = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp2}`, headers: { cookie },
      payload: { primes: 0, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 25000, pret: 0, sanction: 0, autres: 0 },
    });
    expect(avance.statusCode).toBe(200);
    const after2 = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}`, headers: { cookie } })).json();
    const l2 = after2.lines.find((l: { employee_id: string }) => l.employee_id === emp2);
    const l2net0 = before.lines.find((l: { employee_id: string }) => l.employee_id === emp2).net_a_payer;
    expect(l2.net_a_payer).toBe(l2net0 - 25000);
  });

  it("validation réservée au Directeur général : refus d'un rôle non-DG (403)", async () => {
    await createUserWithRole("rh_paie_test", "RESP_RH", ADMIN_PASSWORD);
    const rhLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "rh_paie_test", password: ADMIN_PASSWORD } });
    const rhCookie = extractSessionCookie(rhLogin.cookies.map((c) => `${c.name}=${c.value}`));
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/validate`, headers: { cookie: rhCookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("dg_only");
  });

  it("le DG valide le mois, la saisie est alors verrouillée (409), et il peut rouvrir", async () => {
    // admin porte le rôle ADMIN_GENERAL → autorisé à valider.
    const val = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/validate`, headers: { cookie } });
    expect(val.statusCode).toBe(200);
    expect(val.json().status).toBe("valide");

    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp1}`, headers: { cookie },
      payload: { primes: 1, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().code).toBe("run_locked");

    // Le GET expose le bulletin complet (pour l'impression groupée).
    const detail = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}`, headers: { cookie } })).json();
    expect(detail.status).toBe("valide");
    expect(detail.lines[0].payslip).toBeTruthy();
    expect(detail.lines[0].payslip.net_a_payer).toBeGreaterThan(0);

    const reopen = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/reopen`, headers: { cookie } });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().status).toBe("brouillon");

    const patch2 = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp1}`, headers: { cookie },
      payload: { primes: 0, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch2.statusCode).toBe(200);
  });

  it("le livre de paie reprend les éléments variables du mois", async () => {
    // Prime de 50 000 → brut = base(240 000) + compléments(160 000+50 000) = 450 000.
    await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp1}`, headers: { cookie },
      payload: { primes: 50000, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    const reg = (await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${PERIOD}`, headers: { cookie } })).json();
    expect(reg.monthly_status).toBe("brouillon");
    const line = reg.lines.find((l: { employee_id: string }) => l.employee_id === emp1);
    expect(line.salaire_brut).toBe(450000);
  });
});
