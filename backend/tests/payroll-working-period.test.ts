import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// « Mois de travail » : les écrans de paie se calent par défaut sur le mois le
// plus récent ENCORE OUVERT (brouillon / soumis DG), et non le mois calendaire,
// pour que la finalisation d'un mois faite le mois suivant ne s'impute pas au
// mauvais mois. Un mois validé ne compte pas comme « ouvert ».

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("paie — mois de travail par défaut (dernier mois ouvert)", () => {
  let app: FastifyInstance;
  let cookie: string;
  const periods = ["2099-11", "2099-12"];

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: { in: periods } } });
    // 2099-12 VALIDÉ (ne doit pas être proposé) ; 2099-11 OUVERT (brouillon).
    await prisma.payrollMonthlyRun.create({ data: { periodKey: "2099-12", status: "valide" } });
    await prisma.payrollMonthlyRun.create({ data: { periodKey: "2099-11", status: "brouillon" } });
  });

  afterAll(async () => {
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: { in: periods } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("renvoie le mois ouvert le plus récent (le validé est ignoré)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/payroll/working-period", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { period: string; calendar_month: string; is_past: boolean };

    // L'endpoint est GLOBAL (aucun filtrage par manuscrit) et d'autres tests
    // tournent en parallèle sur la même base — on vérifie donc des propriétés
    // robustes plutôt qu'une égalité exacte sensible aux courses :
    //  • notre mois ouvert (2099-11) garantit un maximum ≥ 2099-11 ;
    //  • le mois renvoyé est un mois OUVERT (jamais un mois validé, ici 2099-12).
    expect(body.period >= "2099-11").toBe(true);
    expect(body.period).not.toBe("2099-12");
    const chosen = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: body.period }, select: { status: true } });
    expect(chosen?.status === "valide").toBe(false);
    expect(body.calendar_month).toBe(new Date().toISOString().slice(0, 7));
    expect(body.is_past).toBe(body.period !== body.calendar_month);
  });
});
