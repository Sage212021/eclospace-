import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Tableau de bord RH : effectif, contrats à échéance, congés, recrutement.

describe("tableau de bord RH", () => {
  let app: FastifyInstance;
  let cookie: string;
  let empId: string;
  const tag = `HRDASH-${Date.now()}`;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const e = await prisma.employee.create({ data: { firstName: tag, lastName: "Dash", leaveBalanceDays: 5 } });
    empId = e.id;
    // Contrat CDD arrivant à échéance dans ~20 jours.
    await prisma.hrContract.create({ data: { employeeId: empId, type: "cdd", startDate: new Date(Date.now() - 300 * 864e5), endDate: new Date(Date.now() + 20 * 864e5) } });
    // Congé en attente de validation.
    await prisma.absence.create({ data: { employeeId: empId, type: "conge", status: "en_attente", fromDate: new Date(Date.now() + 5 * 864e5), toDate: new Date(Date.now() + 9 * 864e5) } });
  });

  afterAll(async () => {
    await prisma.absence.deleteMany({ where: { employeeId: empId } }).catch(() => {});
    await prisma.hrContract.deleteMany({ where: { employeeId: empId } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: empId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("agrège effectif, contrats à échéance et congés en attente", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/hr/dashboard", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const d = res.json();

    expect(d.effectif.total).toBeGreaterThan(0);
    expect(Array.isArray(d.effectif.by_department)).toBe(true);
    expect(Array.isArray(d.effectif.by_contract_type)).toBe(true);

    // Le CDD à échéance apparaît dans la liste.
    const ending = (d.contracts.ending_soon as Array<{ employee: string }>).map((c) => c.employee);
    expect(ending).toContain(`${tag} Dash`);

    // Le congé en attente est compté et listé.
    expect(d.leaves.pending_count).toBeGreaterThan(0);
    const pendingNames = (d.leaves.pending as Array<{ employee: string }>).map((p) => p.employee);
    expect(pendingNames).toContain(`${tag} Dash`);

    // Blocs recrutement/formation présents (chiffres >= 0).
    expect(d.recruitment_training.open_positions).toBeGreaterThanOrEqual(0);
  });
});
