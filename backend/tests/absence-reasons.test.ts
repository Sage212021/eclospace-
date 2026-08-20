import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Intégration des types d'absence du droit du travail (demande opérateur
// 20/08/2026) : catalogue de motifs paramétrable, la catégorie et les règles
// (décompte du solde, faute) découlent du motif.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("catalogue des motifs d'absence", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await app.inject({ method: "POST", url: "/api/v1/employees", headers: { cookie }, payload: { first_name: "Abs", last_name: `Test${rnd()}` } });
    employeeId = emp.json().id;
    await prisma.employee.update({ where: { id: employeeId }, data: { leaveBalanceDays: 30 } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste les motifs actifs (permission, maladie, suspension, injustifiée)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/absence-reasons", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { code: string }[]).map((r) => r.code);
    expect(codes).toContain("mariage_salarie");
    expect(codes).toContain("maternite");
    expect(codes).toContain("mise_a_pied");
    expect(codes).toContain("absence_injustifiee");
  });

  it("le motif impose la catégorie de l'absence créée", async () => {
    // On envoie un type « conge » mais un motif de permission : la catégorie
    // enregistrée doit suivre le motif.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: { cookie },
      payload: { employee_id: employeeId, type: "conge", reason_code: "deces_proche", from_date: "2026-09-01T00:00:00.000Z", to_date: "2026-09-03T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("permission");
    expect(res.json().reasonCode).toBe("deces_proche");
  });

  it("refuse un motif inconnu", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: { cookie },
      payload: { employee_id: employeeId, type: "permission", reason_code: "motif_bidon", from_date: "2026-09-01T00:00:00.000Z", to_date: "2026-09-02T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_reason");
  });

  it("seul un motif « décompte le solde » réduit le solde de congés à la validation", async () => {
    const before = Number((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).leaveBalanceDays);

    // Permission (ne décompte pas) validée → solde inchangé.
    const perm = await app.inject({ method: "POST", url: "/api/v1/absences", headers: { cookie }, payload: { employee_id: employeeId, type: "permission", reason_code: "mariage_salarie", from_date: "2026-10-01T00:00:00.000Z", to_date: "2026-10-03T00:00:00.000Z" } });
    await app.inject({ method: "PATCH", url: `/api/v1/absences/${perm.json().id}/decide`, headers: { cookie }, payload: { decision: "validee" } });
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).leaveBalanceDays)).toBe(before);

    // Congé annuel (décompte) validé → solde réduit de 3 jours (1er→3 inclus).
    const conge = await app.inject({ method: "POST", url: "/api/v1/absences", headers: { cookie }, payload: { employee_id: employeeId, type: "conge", reason_code: "conge_annuel", from_date: "2026-11-01T00:00:00.000Z", to_date: "2026-11-03T00:00:00.000Z" } });
    await app.inject({ method: "PATCH", url: `/api/v1/absences/${conge.json().id}/decide`, headers: { cookie }, payload: { decision: "validee" } });
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).leaveBalanceDays)).toBe(before - 3);
  });

  it("une absence fautive validée signale la RH/DG", async () => {
    const inj = await app.inject({ method: "POST", url: "/api/v1/absences", headers: { cookie }, payload: { employee_id: employeeId, type: "injustifiee", reason_code: "absence_injustifiee", from_date: "2026-12-01T00:00:00.000Z", to_date: "2026-12-02T00:00:00.000Z" } });
    await app.inject({ method: "PATCH", url: `/api/v1/absences/${inj.json().id}/decide`, headers: { cookie }, payload: { decision: "validee" } });
    const notif = await prisma.notification.findFirst({ where: { entityType: "absence", entityId: inj.json().id, title: "Absence fautive signalée" } });
    expect(notif).toBeTruthy();
  });

  it("le paramétrage d'un motif est modifiable (règles) et pris en compte", async () => {
    // On rend la « permission personnelle » non payée + retenue de paie.
    const put = await app.inject({ method: "PATCH", url: "/api/v1/absence-reasons/permission_personnelle", headers: { cookie }, payload: { paid: false, payroll_deductible: true } });
    expect(put.statusCode).toBe(200);
    expect(put.json().paid).toBe(false);
    expect(put.json().payrollDeductible).toBe(true);
    // Restauration (ne pas contaminer les autres suites qui partagent la base).
    await app.inject({ method: "PATCH", url: "/api/v1/absence-reasons/permission_personnelle", headers: { cookie }, payload: { paid: true, payroll_deductible: false } });
  });
});
