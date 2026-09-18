import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// FUSION d'un doublon employé (RÉGRESSION « BIBI apparaît deux fois dans le
// livre de paie ») : deux fiches = même personne (nom/prénom inversés), toutes
// deux dotées d'une fiche paie et d'une ligne dans le mois → le livre les compte
// DEUX fois. Après fusion, il n'en reste qu'UNE ; les garde-fous protègent une
// paie validée et un compte utilisateur.

describe("RH — fusion d'un doublon employé", () => {
  let app: FastifyInstance;
  let cookie: string;
  const tag = `MERGE-${Date.now()}`;
  const period = "2034-03";
  const rateLabel = `Barème ${tag}`;
  const created: string[] = [];

  const login = async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login();
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } });
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), label: rateLabel,
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
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } }).catch(() => {});
    await prisma.payrollEmployeeProfile.deleteMany({ where: { employeeId: { in: created } } }).catch(() => {});
    await prisma.payrollMonthlyLine.deleteMany({ where: { employeeId: { in: created } } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { user: { employeeId: { in: created } } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { employeeId: { in: created } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await prisma.payrollRateSet.deleteMany({ where: { label: rateLabel } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const monthlyEmployeeIds = async () =>
    ((await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${period}`, headers: { cookie } })).json().lines as Array<{ employee_id: string }>).map((l) => l.employee_id);

  it("fusionne les deux fiches : le livre de paie ne compte plus le doublon", async () => {
    // Même personne, nom/prénom inversés.
    const keeper = await prisma.employee.create({ data: { firstName: `${tag} BIBI TSANGA`, lastName: "VALENTIN" } });
    const loser = await prisma.employee.create({ data: { firstName: `${tag} VALENTIN`, lastName: "BIBI TSANGA" } });
    created.push(keeper.id, loser.id);
    await prisma.payrollEmployeeProfile.create({ data: { employeeId: keeper.id, grossContractual: 249507, basePct: 1 } });
    await prisma.payrollEmployeeProfile.create({ data: { employeeId: loser.id, grossContractual: 249507, basePct: 1 } });

    // Le mois prépare une ligne pour CHAQUE fiche → doublon dans le livre.
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${period}/prepare`, headers: { cookie } });
    const before = await monthlyEmployeeIds();
    expect(before).toContain(keeper.id);
    expect(before).toContain(loser.id);

    // Fusion : le doublon (loser) est absorbé dans la fiche conservée (keeper).
    const res = await app.inject({ method: "POST", url: `/api/v1/employees/${loser.id}/merge`, headers: { cookie }, payload: { into: keeper.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged).toBe(true);
    // La ligne du mois du doublon entre en collision avec celle du gagnant → écartée.
    expect(res.json().moved.bulletins_ecartes).toBe(1);

    // Le doublon est supprimé logiquement, sa fiche paie retirée.
    expect((await prisma.employee.findUnique({ where: { id: loser.id } }))?.deletedAt).not.toBeNull();
    expect(await prisma.payrollEmployeeProfile.findUnique({ where: { employeeId: loser.id } })).toBeNull();
    expect((await prisma.employee.findUnique({ where: { id: keeper.id } }))?.deletedAt).toBeNull();

    // Le livre de paie ne liste plus qu'UNE fiche.
    const after = await monthlyEmployeeIds();
    expect(after).toContain(keeper.id);
    expect(after).not.toContain(loser.id);

    // Plus de groupe de doublons pour cette personne.
    const groups = (await app.inject({ method: "GET", url: "/api/v1/hr/duplicates", headers: { cookie } })).json().groups as Array<{ records: Array<{ employee_id: string }> }>;
    expect(groups.find((g) => g.records.some((r) => r.employee_id === keeper.id) && g.records.length > 1)).toBeFalsy();
  });

  it("refuse de fusionner un doublon qui porte un compte utilisateur", async () => {
    const keeper = await prisma.employee.create({ data: { firstName: `${tag} MARTHE`, lastName: "MFOUT" } });
    const loser = await prisma.employee.create({ data: { firstName: `${tag} MFOUT`, lastName: "MARTHE" } });
    created.push(keeper.id, loser.id);
    await prisma.user.create({ data: { employeeId: loser.id, username: `${tag}-marthe`, email: `${tag}-marthe@eclospace.local`, passwordHash: await argon2.hash("Motdepasse1!") } });

    const res = await app.inject({ method: "POST", url: `/api/v1/employees/${loser.id}/merge`, headers: { cookie }, payload: { into: keeper.id } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("loser_has_account");
    // Rien n'a été supprimé.
    expect((await prisma.employee.findUnique({ where: { id: loser.id } }))?.deletedAt).toBeNull();
  });

  it("refuse de fusionner un doublon présent dans une paie VALIDÉE (livre figé)", async () => {
    const keeper = await prisma.employee.create({ data: { firstName: `${tag} SERAPHINE`, lastName: "ABOUH" } });
    const loser = await prisma.employee.create({ data: { firstName: `${tag} ABOUH`, lastName: "SERAPHINE" } });
    created.push(keeper.id, loser.id);
    const run = await prisma.payrollMonthlyRun.create({ data: { periodKey: "2034-04", status: "valide" } });
    await prisma.payrollMonthlyLine.create({ data: { runId: run.id, employeeId: loser.id } });

    try {
      const res = await app.inject({ method: "POST", url: `/api/v1/employees/${loser.id}/merge`, headers: { cookie }, payload: { into: keeper.id } });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("loser_in_frozen_payroll");
      expect((await prisma.employee.findUnique({ where: { id: loser.id } }))?.deletedAt).toBeNull();
    } finally {
      await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: "2034-04" } }).catch(() => {});
    }
  });

  it("refuse une fusion sur elle-même (400)", async () => {
    const e = await prisma.employee.create({ data: { firstName: `${tag} SOLO`, lastName: "UNIQUE" } });
    created.push(e.id);
    const res = await app.inject({ method: "POST", url: `/api/v1/employees/${e.id}/merge`, headers: { cookie }, payload: { into: e.id } });
    expect(res.statusCode).toBe(400);
  });
});
