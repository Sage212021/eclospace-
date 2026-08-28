import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Lot 3 — machine à états de la paie mensuelle (chantier RH 12/08/2026).
// brouillon → (RH soumet) soumis_dg → (DG retourne, motif) brouillon
//                                    → (DG valide) valide (verrouillé).
// Couvre les tests 6, 7, 8, 9 du cahier des charges RH.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2032-03"; // période dédiée (DB de test partagée)

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("paie mensuelle : machine à états (soumission RH → validation/retour DG)", () => {
  let app: FastifyInstance;
  let dgCookie: string; // admin (ADMIN_GENERAL) : joue le DG
  let rhCookie: string; // RESP_RH : saisie, mais pas la validation DG
  let emp: string;
  let rhId: string; // le RH qui soumet (destinataire des notifs retour/validation)
  let dafUsername: string; // RESP_FINANCE : notifié à la validation pour le suivi
  const createdUsernames: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    dgCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const rhU = `rhsm_${Math.random().toString(36).slice(2, 7)}`;
    rhId = (await createUserWithRole(rhU, "RESP_RH", ADMIN_PASSWORD)).id;
    createdUsernames.push(rhU);
    rhCookie = await loginCookie(app, rhU, ADMIN_PASSWORD);
    // DAF (Responsable administratif et financier) : notifié à la validation.
    dafUsername = `dafsm_${Math.random().toString(36).slice(2, 7)}`;
    await createUserWithRole(dafUsername, "RESP_FINANCE", ADMIN_PASSWORD);
    createdUsernames.push(dafUsername);

    // Repartir propre sur la période dédiée.
    const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: PERIOD } });
    if (run) {
      await prisma.payrollMonthlyLine.deleteMany({ where: { runId: run.id } });
      await prisma.payrollMonthlyRun.delete({ where: { id: run.id } });
    }
    // Barème dédié (date ≤ période, postérieure aux autres fichiers de test).
    const existingRate = await prisma.payrollRateSet.findFirst({ where: { effectiveFrom: new Date("2032-01-01T00:00:00.000Z") } });
    if (!existingRate) {
      await prisma.payrollRateSet.create({
        data: {
          effectiveFrom: new Date("2032-01-01T00:00:00.000Z"), label: "Barème machine à états",
          vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
          abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
          coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
          irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
          irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
          tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
        },
      });
    }
    const e = await prisma.employee.create({ data: { firstName: "État", lastName: "Machine" } });
    emp = e.id;
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${emp}/profile`, headers: { cookie: dgCookie },
      payload: { gross_contractual: 350000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie: rhCookie } });
  });

  afterAll(async () => {
    for (const username of createdUsernames) {
      try {
        await prisma.user.updateMany({ where: { username }, data: { status: "disabled" } });
      } catch {
        /* nettoyage non bloquant */
      }
    }
    await app.close();
    await prisma.$disconnect();
  });

  it("Test 6 — le RH soumet au DG ; la grille se fige (saisie refusée 409)", async () => {
    const sub = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie: rhCookie } });
    expect(sub.statusCode).toBe(200);
    expect(sub.json().status).toBe("soumis_dg");

    // Le DG (admin, ADMIN_GENERAL) est notifié « à valider ».
    const dg = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const dgNotif = await prisma.notification.findFirst({ where: { userId: dg.id, entityType: "payroll_monthly_run", entityId: PERIOD, title: { contains: "à valider" } } });
    expect(dgNotif).toBeTruthy();

    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp}`, headers: { cookie: rhCookie },
      payload: { primes: 5000, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().code).toBe("run_submitted");
  });

  it("le retour au RH exige un motif (400) et est réservé au DG (403)", async () => {
    // Un RH ne peut pas retourner.
    const byRh = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/return`, headers: { cookie: rhCookie }, payload: { reason: "test" } });
    expect(byRh.statusCode).toBe(403);
    expect(byRh.json().code).toBe("dg_only");
    // Le DG doit fournir un motif.
    const noReason = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/return`, headers: { cookie: dgCookie }, payload: {} });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().code).toBe("reason_required");
  });

  it("Test 7 — le DG retourne la paie avec motif ; elle redevient modifiable", async () => {
    const ret = await app.inject({
      method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/return`, headers: { cookie: dgCookie },
      payload: { reason: "Vérifier le salaire de base de l'employé État Machine." },
    });
    expect(ret.statusCode).toBe(200);
    expect(ret.json().status).toBe("brouillon");

    const month = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}`, headers: { cookie: dgCookie } })).json();
    expect(month.status).toBe("brouillon");
    expect(month.return_reason).toContain("Vérifier le salaire de base");

    // Le RH qui a soumis est notifié du retour, avec le motif.
    const rhNotif = await prisma.notification.findFirst({ where: { userId: rhId, entityType: "payroll_monthly_run", entityId: PERIOD, title: { contains: "retournée" } } });
    expect(rhNotif).toBeTruthy();

    // Redevenue modifiable.
    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp}`, headers: { cookie: rhCookie },
      payload: { primes: 7000, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch.statusCode).toBe(200);
  });

  it("Test 8 & 9 — le DG valide après re-soumission ; la paie est verrouillée", async () => {
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie: rhCookie } });

    // Avant validation, le DIPE est « provisoire ».
    const dipeBefore = (await app.inject({ method: "GET", url: `/api/v1/payroll/dipe?period=${PERIOD}`, headers: { cookie: dgCookie } })).json();
    expect(dipeBefore.official).toBe(false);

    const val = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/validate`, headers: { cookie: dgCookie } });
    expect(val.statusCode).toBe(200);
    expect(val.json().status).toBe("valide");

    // À la validation : le RH est informé, et le DAF est notifié pour le suivi.
    const rhOk = await prisma.notification.findFirst({ where: { userId: rhId, entityType: "payroll_monthly_run", entityId: PERIOD, title: { contains: "validée" } } });
    expect(rhOk).toBeTruthy();
    const daf = await prisma.user.findFirstOrThrow({ where: { username: dafUsername } });
    const dafNotif = await prisma.notification.findFirst({ where: { userId: daf.id, entityType: "payroll_monthly_run", entityId: PERIOD, title: { contains: "à prendre en charge" } } });
    expect(dafNotif).toBeTruthy();

    // Après validation, le DIPE devient « définitif ».
    const dipeAfter = (await app.inject({ method: "GET", url: `/api/v1/payroll/dipe?period=${PERIOD}`, headers: { cookie: dgCookie } })).json();
    expect(dipeAfter.official).toBe(true);

    const patch = await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp}`, headers: { cookie: rhCookie },
      payload: { primes: 1, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().code).toBe("run_locked");
  });

  it("Test 10 — le DG renvoie une paie validée au RH pour correction (motif) ; RH notifié", async () => {
    // Réservé au DG.
    const byRh = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/reopen`, headers: { cookie: rhCookie }, payload: { reason: "x" } });
    expect(byRh.statusCode).toBe(403);

    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/reopen`, headers: { cookie: dgCookie }, payload: { reason: "Corriger la prime de M. X" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("brouillon");
    expect(res.json().return_reason).toContain("Corriger la prime");

    const month = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}`, headers: { cookie: dgCookie } })).json();
    expect(month.status).toBe("brouillon");
    expect(month.return_reason).toContain("Corriger la prime"); // le RH voit le motif

    // Le RH (qui avait soumis) est notifié du renvoi pour correction.
    const notif = await prisma.notification.findFirst({ where: { userId: rhId, entityType: "payroll_monthly_run", entityId: PERIOD, title: { contains: "renvoyée pour correction" } } });
    expect(notif).toBeTruthy();
  });
});
