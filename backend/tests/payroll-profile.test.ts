import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Fiche paie de l'employé (D-007, incrément 2).

const PROFILE = {
  matricule: "ECL-001",
  cnps_number: "C-YAO-0001",
  niu: "M0219...",
  category: "Cadre 8A",
  payment_mode: "Virement",
  account_number: "0001234567",
  gross_contractual: 500000,
  base_pct: 0.6,
  fiscal_parts: 2.5,
  apply_fiscal_parts: true,
  seniority_years: 4,
  apply_seniority: true,
};

describe("fiche paie employé", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const resA = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    adminCookie = extractSessionCookie(resA.cookies.map((c) => `${c.name}=${c.value}`));
    await createUserWithRole("paie_profil_simple", "CORRECTEUR", "PaieProf123!");
    const resP = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "paie_profil_simple", password: "PaieProf123!" } });
    plainCookie = extractSessionCookie(resP.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Fiche", lastName: "Paie" } });
    employeeId = emp.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse la consultation à un profil non habilité (403)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/profile`, headers: { cookie: plainCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("renvoie une fiche vide (null) pour un employé sans fiche", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/profile`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile).toBeNull();
  });

  it("enregistre une fiche et calcule base + compléments", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/profile`, headers: { cookie: adminCookie }, payload: PROFILE });
    expect(put.statusCode).toBe(200);
    const p = put.json();
    // base = 500000 × 0,6 = 300000 ; compléments = 200000.
    expect(p.base_salary).toBe(300000);
    expect(p.complements).toBe(200000);
    expect(p.fiscal_parts).toBe(2.5);
    expect(p.matricule).toBe("ECL-001");

    const get = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/profile`, headers: { cookie: adminCookie } });
    expect(get.json().profile.cnps_number).toBe("C-YAO-0001");
  });

  it("refuse un pourcentage de base hors bornes (400)", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/profile`, headers: { cookie: adminCookie }, payload: { ...PROFILE, base_pct: 1.5 } });
    expect(res.statusCode).toBe(400);
  });

  it("404 pour un employé inexistant", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/00000000-0000-0000-0000-000000000000/profile`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(404);
  });

  it("accepte un motif de modification et le trace au journal", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/payroll/employees/${employeeId}/profile`,
      headers: { cookie: adminCookie },
      payload: { ...PROFILE, modification_reason: "Correction du brut après avenant" },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "payroll_employee_profile", entityId: employeeId, action: "update" },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValues)).toContain("Correction du brut après avenant");
  });
});
