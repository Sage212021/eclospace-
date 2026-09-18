import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// CORRECTION CRITIQUE PAIE — le salaire est rattaché à la PÉRIODE (figé sur la
// ligne du mois). Une correction faite plus tard reste dans sa période ; changer
// la fiche globale ne modifie plus les mois déjà préparés ; chaque période est
// indépendante. Cas BIBI TSANGA (93 000 d'août ≠ septembre) et Abou Mbah
// Séraphine (présente si paie valide).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const AOUT = "2089-08";
const SEPT = "2089-09";
const OCT = "2089-10";

describe("Paie — salaire rattaché à la période (figé sur la ligne du mois)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let bibiId: string;
  let seraId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const registerBody = async (period: string) => {
    const r = await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${period}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return r.json();
  };
  const netOf = async (period: string, empId: string): Promise<number | null> => {
    const body = await registerBody(period);
    const line = (body.lines as Array<{ employee_id: string; net_a_payer: number }>).find((l) => l.employee_id === empId);
    return line ? line.net_a_payer : null;
  };
  const setProfile = (empId: string, gross: number) =>
    app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${empId}/profile`, headers: { cookie },
      payload: { gross_contractual: gross, base_pct: 1, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false } });
  const prepare = (period: string) => app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${period}/prepare`, headers: { cookie } });
  const editLine = (period: string, empId: string, patch: Record<string, number>) =>
    app.inject({ method: "PATCH", url: `/api/v1/payroll/monthly/${period}/lines/${empId}`, headers: { cookie },
      payload: { heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0, ...patch } });

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    bibiId = (await prisma.employee.create({ data: { firstName: "Bibi", lastName: `Tsanga-${Math.random().toString(36).slice(2, 6)}` } })).id;
    seraId = (await prisma.employee.create({ data: { firstName: "Séraphine", lastName: `Abou-${Math.random().toString(36).slice(2, 6)}` } })).id;
  });

  afterAll(async () => {
    for (const per of [AOUT, SEPT, OCT]) {
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: per } });
      if (run) await prisma.payrollMonthlyLine.deleteMany({ where: { runId: run.id } }).catch(() => {});
      await prisma.payrollClosure.deleteMany({ where: { periodKey: per } }).catch(() => {});
      await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: per } }).catch(() => {});
    }
    await prisma.payrollEmployeeProfile.deleteMany({ where: { employeeId: { in: [bibiId, seraId] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: { in: [bibiId, seraId] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("changer la fiche APRÈS préparation ne modifie pas les mois déjà préparés (indépendance)", async () => {
    await setProfile(bibiId, 93000);
    await prepare(AOUT);   // ligne août figée à 93 000
    await prepare(SEPT);   // ligne sept figée à 93 000
    const aoutBefore = await netOf(AOUT, bibiId);
    const septBefore = await netOf(SEPT, bibiId);
    expect(aoutBefore).not.toBeNull();
    expect(septBefore).toBe(aoutBefore);

    // On change la fiche globale (comme si on éditait le salaire « en général »).
    await setProfile(bibiId, 400000);
    // Les mois DÉJÀ préparés ne bougent pas : leur salaire est figé sur la ligne.
    expect(await netOf(AOUT, bibiId)).toBe(aoutBefore);
    expect(await netOf(SEPT, bibiId)).toBe(septBefore);
  });

  it("corriger le salaire de SEPTEMBRE reste dans septembre ; août garde 93 000 (cas BIBI)", async () => {
    // Le gestionnaire ouvre septembre et corrige le salaire de BIBI à 220 000.
    const r = await editLine(SEPT, bibiId, { base_salary: 220000, gross_contractual: 220000 });
    expect(r.statusCode).toBe(200);
    const septNet = await netOf(SEPT, bibiId);
    const aoutNet = await netOf(AOUT, bibiId);
    // Septembre reflète 220 000 (net plus élevé) ; août reste sur 93 000.
    expect(septNet!).toBeGreaterThan(aoutNet!);
    // Octobre n'a jamais été préparé : la correction de septembre n'y apparaît pas.
    const octBody = await registerBody(OCT);
    expect((octBody.lines as Array<{ employee_id: string }>).some((l) => l.employee_id === bibiId)).toBe(false);
  });

  it("un salarié à paie valide (Séraphine) est signalé puis intégré au mois (jamais invisible)", async () => {
    // Sa fiche est créée APRÈS la préparation de septembre.
    await setProfile(seraId, 150000);
    const before = await registerBody(SEPT);
    // Pas encore de ligne septembre → signalée dans « missing_profiles », absente des lignes.
    expect((before.missing_profiles as Array<{ employee_id: string }>).some((m) => m.employee_id === seraId)).toBe(true);
    expect((before.lines as Array<{ employee_id: string }>).some((l) => l.employee_id === seraId)).toBe(false);

    // « Préparer le mois » l'intègre (sans toucher aux autres).
    await prepare(SEPT);
    const after = await registerBody(SEPT);
    expect((after.lines as Array<{ employee_id: string }>).some((l) => l.employee_id === seraId)).toBe(true);
    expect((after.missing_profiles as Array<{ employee_id: string }>).some((m) => m.employee_id === seraId)).toBe(false);
  });

  it("détecte une incohérence bulletin ↔ clôture (net figé ≠ net recalculé)", async () => {
    // On clôture septembre, puis on simule une clôture faite sur d'autres données
    // en altérant le net figé du journal : le contrôle doit le signaler.
    await app.inject({ method: "POST", url: `/api/v1/payroll/register/${SEPT}/close`, headers: { cookie } });
    const closure = await prisma.payrollClosure.findUniqueOrThrow({ where: { periodKey: SEPT } });
    await prisma.payrollJournalLine.updateMany({ where: { closureId: closure.id, employeeId: bibiId }, data: { netAPayer: 1 } });
    const body = await registerBody(SEPT);
    expect((body.incoherences as Array<{ employee_id: string }>).some((i) => i.employee_id === bibiId)).toBe(true);
  });
});
