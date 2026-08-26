import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Temps 2 — suivi de prise en charge de la paie par le DAF après validation DG :
// check-list datée (décaissement, déclarations CNPS/impôts, archivage) puis
// clôture du cycle. Écriture réservée au DAF (finance:validation) ; le RH ne l'a
// pas. Le fil de validation est daté.

const PWD = "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const PV = "2033-01"; // mois validé
const PB = "2033-02"; // mois en brouillon

async function loginCookie(app: FastifyInstance, u: string, p: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("suivi de prise en charge de la paie par le DAF (Temps 2)", () => {
  let app: FastifyInstance;
  let dafCookie: string; // RESP_FINANCE : finance:validation
  let rhCookie: string; // RESP_RH : paie mais pas finance:validation
  const created: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const dafU = `dafho_${rnd()}`;
    await createUserWithRole(dafU, "RESP_FINANCE", PWD);
    created.push(dafU);
    dafCookie = await loginCookie(app, dafU, PWD);
    const rhU = `rhho_${rnd()}`;
    const rh = await createUserWithRole(rhU, "RESP_RH", PWD);
    created.push(rhU);
    rhCookie = await loginCookie(app, rhU, PWD);
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });

    for (const key of [PV, PB]) {
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: key } });
      if (run) await prisma.payrollMonthlyRun.delete({ where: { id: run.id } });
      await prisma.payrollHandoff.deleteMany({ where: { periodKey: key } });
    }
    await prisma.payrollMonthlyRun.create({
      data: { periodKey: PV, status: "valide", preparedBy: rh.id, submittedBy: rh.id, submittedAt: new Date(), validatedBy: admin.id, validatedAt: new Date() },
    });
    await prisma.payrollMonthlyRun.create({ data: { periodKey: PB, status: "brouillon", preparedBy: rh.id } });
  });

  afterAll(async () => {
    for (const u of created) { try { await prisma.user.updateMany({ where: { username: u }, data: { status: "disabled" } }); } catch { /* non bloquant */ } }
    await app.close();
    await prisma.$disconnect();
  });

  it("avant validation, le suivi DAF est refusé", async () => {
    const meta = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PB}/handoff`, headers: { cookie: dafCookie } })).json();
    expect(meta.validated).toBe(false);
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/monthly/${PB}/handoff`, headers: { cookie: dafCookie }, payload: { salaries_paid: true } });
    expect(put.statusCode).toBe(409);
    expect(put.json().code).toBe("not_validated");
  });

  it("le fil de validation est daté (préparé → soumis → validé)", async () => {
    const meta = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PV}/handoff`, headers: { cookie: dafCookie } })).json();
    expect(meta.validated).toBe(true);
    const steps = (meta.timeline as { step: string }[]).map((s) => s.step);
    expect(steps).toContain("validate");
    expect(steps).toContain("prepare");
  });

  it("le DAF coche une étape ; elle est datée", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/monthly/${PV}/handoff`, headers: { cookie: dafCookie }, payload: { salaries_paid: true } });
    expect(put.statusCode).toBe(200);
    const meta = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PV}/handoff`, headers: { cookie: dafCookie } })).json();
    const item = (meta.items as { key: string; done: boolean; at: string | null }[]).find((i) => i.key === "salaries_paid");
    expect(item?.done).toBe(true);
    expect(item?.at).toBeTruthy();
  });

  it("le RH ne peut pas éditer le suivi (403)", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/monthly/${PV}/handoff`, headers: { cookie: rhCookie }, payload: { salaries_paid: false } });
    expect(put.statusCode).toBe(403);
  });

  it("clôture refusée tant que tout n'est pas coché, puis autorisée ; le DG est notifié", async () => {
    const early = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PV}/handoff/close`, headers: { cookie: dafCookie } });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("handoff_incomplete");

    await app.inject({ method: "PUT", url: `/api/v1/payroll/monthly/${PV}/handoff`, headers: { cookie: dafCookie }, payload: { cnps_declared: true, cnps_ref: "CNPS-2033-01", tax_declared: true, tax_ref: "IMP-2033-01", archived: true } });
    const close = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PV}/handoff/close`, headers: { cookie: dafCookie } });
    expect(close.statusCode).toBe(200);
    expect(close.json().closed).toBe(true);

    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const notif = await prisma.notification.findFirst({ where: { userId: admin.id, entityType: "payroll_handoff", entityId: PV, title: { contains: "cycle bouclé" } } });
    expect(notif).toBeTruthy();
  });

  it("après clôture, modification refusée puis réouverture rétablit l'édition", async () => {
    const blocked = await app.inject({ method: "PUT", url: `/api/v1/payroll/monthly/${PV}/handoff`, headers: { cookie: dafCookie }, payload: { salaries_paid: false } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("handoff_closed");

    const reopen = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PV}/handoff/reopen`, headers: { cookie: dafCookie } });
    expect(reopen.statusCode).toBe(200);
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/monthly/${PV}/handoff`, headers: { cookie: dafCookie }, payload: { salaries_paid: true } });
    expect(put.statusCode).toBe(200);
  });
});
