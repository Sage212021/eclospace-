import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// CORRECTION (D-044) : la clôture d'un mois doit lister TOUS les salariés ayant
// une fiche de paie enregistrée pour ce mois — y compris un salarié parti depuis
// (supprimé logiquement, deletedAt). Auparavant le livre de paie / la clôture
// filtrait `employee.deletedAt = null`, alors que la grille de saisie non : d'où
// « 5 fiches saisies, seulement 3 à la clôture » (cas DAF : M. Bibi et ABOU MBAH
// SÉRAPHINE manquants). Régression garantie ici.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2088-08"; // août, période isolée

describe("Clôture de paie — tous les salariés avec fiche du mois (D-044)", () => {
  let app: FastifyInstance;
  let cookie: string;
  const empIds: string[] = [];
  const names: { first: string; last: string }[] = [
    { first: "M.", last: "Bibi" },
    { first: "Séraphine", last: "ABOU MBAH" },
    { first: "Trois", last: "Salarié" },
    { first: "Quatre", last: "Salarié" },
    { first: "Cinq", last: "Salarié" },
  ];

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const registerIds = async (): Promise<string[]> => {
    const r = await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${PERIOD}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return (r.json().lines as Array<{ employee_id: string }>).map((l) => l.employee_id);
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);

    // 5 salariés, chacun avec une fiche paie (profil) + un salaire de base.
    for (const n of names) {
      const e = await prisma.employee.create({ data: { firstName: n.first, lastName: n.last } });
      empIds.push(e.id);
      const put = await app.inject({
        method: "PUT", url: `/api/v1/payroll/employees/${e.id}/profile`, headers: { cookie },
        payload: { gross_contractual: 300000, base_pct: 1, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
      });
      expect(put.statusCode).toBe(200);
    }

    // Préparer août → une ligne (fiche de paie du mois) par salarié.
    const prep = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    expect(prep.statusCode).toBe(200);

    // Deux salariés QUITTENT l'entreprise APRÈS la saisie de leur paie d'août
    // (suppression logique). Leur fiche d'août reste enregistrée.
    await prisma.employee.updateMany({ where: { id: { in: [empIds[0], empIds[1]] } }, data: { deletedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.payrollClosure.deleteMany({ where: { periodKey: PERIOD } }).catch(() => {});
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: PERIOD } }).catch(() => {});
    await prisma.payrollEmployeeProfile.deleteMany({ where: { employeeId: { in: empIds } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: { in: empIds } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("le livre de paie liste les 5 salariés — y compris les 2 partis (deletedAt)", async () => {
    const ids = await registerIds();
    for (const id of empIds) expect(ids).toContain(id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });

  it("la clôture archive les 5 fiches (M. Bibi et ABOU MBAH SÉRAPHINE compris)", async () => {
    // Nombre de lignes réellement enregistrées pour le mois (base de test partagée :
    // d'autres salariés peuvent exister — la clôture doit toutes les archiver).
    const run = await prisma.payrollMonthlyRun.findUniqueOrThrow({ where: { periodKey: PERIOD } });
    const lineCount = await prisma.payrollMonthlyLine.count({ where: { runId: run.id } });

    // La clôture exige la validation du DG : on soumet puis on valide (admin).
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/validate`, headers: { cookie } });
    const close = await app.inject({ method: "POST", url: `/api/v1/payroll/register/${PERIOD}/close`, headers: { cookie } });
    expect(close.statusCode).toBe(200);
    // La clôture archive AUTANT de bulletins qu'il y a de fiches du mois (aucune perdue).
    expect(close.json().employees).toBe(lineCount);

    const journal = (await app.inject({ method: "GET", url: `/api/v1/payroll/journal/${PERIOD}`, headers: { cookie } })).json();
    const journalIds = (journal.lines as Array<{ employee_id: string }>).map((l) => l.employee_id);
    for (const id of empIds) expect(journalIds).toContain(id); // les 5, dont les 2 partis
    // Les noms des deux salariés partis sont bien archivés.
    const journalNames = (journal.lines as Array<{ employee_name: string }>).map((l) => l.employee_name);
    expect(journalNames.some((n) => n.includes("Bibi"))).toBe(true);
    expect(journalNames.some((n) => n.includes("ABOU MBAH"))).toBe(true);
  });
});
