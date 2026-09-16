import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// CORRECTION (D-041) : une paie appartient à UNE période (employé + période).
// La présence d'un salarié en base ne fait plus apparaître sa paie dans tous les
// mois : le livre de paie d'un mois ne contient QUE les salariés dont une paie a
// été réellement créée pour ce mois. Scénario opérateur (Dorian).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const AOUT = "2099-08";
const SEPT = "2099-09";
const OCT = "2099-10";

describe("Paie — isolation stricte par période (D-041)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let dorianId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const registerIds = async (period: string): Promise<string[]> => {
    const r = await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${period}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return (r.json().lines as Array<{ employee_id: string }>).map((l) => l.employee_id);
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    const dorian = await prisma.employee.create({ data: { firstName: "Dorian", lastName: "TestPériode" } });
    dorianId = dorian.id;
    // Fiche paie permanente (via l'API, comme le RH).
    const prof = await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${dorianId}/profile`, headers: { cookie },
      payload: { matricule: "DOR-001", gross_contractual: 300000, base_pct: 0.5, fiscal_parts: 1, apply_fiscal_parts: false, seniority_years: 0, apply_seniority: false },
    });
    expect(prof.statusCode).toBe(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it("une paie créée pour septembre n'apparaît qu'en septembre", async () => {
    // Préparer SEPTEMBRE seulement.
    const prep = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${SEPT}/prepare`, headers: { cookie } });
    expect(prep.statusCode).toBe(200);

    expect(await registerIds(SEPT)).toContain(dorianId); // septembre : présent
    expect(await registerIds(AOUT)).not.toContain(dorianId); // août : absent (aucune paie d'août)
    expect(await registerIds(OCT)).not.toContain(dorianId); // octobre : absent (non préparé)
  });

  it("aucune paie n'est générée automatiquement pour les mois futurs", async () => {
    // Octobre n'a jamais été préparé : son livre de paie est vide de Dorian.
    const oct = await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${OCT}`, headers: { cookie } });
    // Le mois peut ne pas exister (jamais préparé) → exists:false, aucune ligne.
    if (oct.json().exists) {
      expect((oct.json().lines as Array<{ employee_id: string }>).map((l) => l.employee_id)).not.toContain(dorianId);
    } else {
      expect(oct.json().exists).toBe(false);
    }
  });

  it("supprimer la fiche de paie de septembre (mois ouvert) la retire — et elle ne réapparaît pas", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/v1/payroll/monthly/${SEPT}/lines/${dorianId}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    // Retiré du livre de paie de septembre.
    expect(await registerIds(SEPT)).not.toContain(dorianId);
    // Et pas de résurrection automatique à la consultation de la grille.
    const grid = await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${SEPT}`, headers: { cookie } });
    expect((grid.json().lines as Array<{ employee_id: string }>).map((l) => l.employee_id)).not.toContain(dorianId);

    // Deuxième suppression → 404 (plus de ligne).
    const del2 = await app.inject({ method: "DELETE", url: `/api/v1/payroll/monthly/${SEPT}/lines/${dorianId}`, headers: { cookie } });
    expect(del2.statusCode).toBe(404);
  });
});
