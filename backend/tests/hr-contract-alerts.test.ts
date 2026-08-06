import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Alertes d'expiration des contrats de travail (refonte RH — Étape 3).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("alertes d'expiration de contrats", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste les contrats à échéance dans l'horizon (et exclut ceux hors horizon)", async () => {
    const soon = await prisma.employee.create({ data: { firstName: "Bientôt", lastName: "Expire" } });
    const far = await prisma.employee.create({ data: { firstName: "Loin", lastName: "Terme" } });
    const in30 = new Date(Date.now() + 30 * 864e5);
    const in300 = new Date(Date.now() + 300 * 864e5);
    const cSoon = await prisma.hrContract.create({ data: { employeeId: soon.id, type: "cdd", startDate: new Date(), endDate: in30 } });
    await prisma.hrContract.create({ data: { employeeId: far.id, type: "cdd", startDate: new Date(), endDate: in300 } });

    const res = await app.inject({ method: "GET", url: "/api/v1/hr/contract-alerts?days=60", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().alerts as { contract_id: string }[]).map((a) => a.contract_id);
    expect(ids).toContain(cSoon.id);
    const soonAlert = (res.json().alerts as { contract_id: string; status: string; days_left: number }[]).find((a) => a.contract_id === cSoon.id)!;
    expect(soonAlert.status).toBe("expiring");
    expect(soonAlert.days_left).toBeGreaterThan(0);
  });

  it("marque « expired » un contrat déjà échu", async () => {
    const emp = await prisma.employee.create({ data: { firstName: "Déjà", lastName: "Échu" } });
    const past = new Date(Date.now() - 5 * 864e5);
    const c = await prisma.hrContract.create({ data: { employeeId: emp.id, type: "cdd", startDate: new Date(Date.now() - 400 * 864e5), endDate: past } });
    const res = await app.inject({ method: "GET", url: "/api/v1/hr/contract-alerts", headers: { cookie } });
    const a = (res.json().alerts as { contract_id: string; status: string }[]).find((x) => x.contract_id === c.id)!;
    expect(a.status).toBe("expired");
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/hr/contract-alerts" });
    expect(res.statusCode).toBe(401);
  });

  it("avenant : ajouté à un contrat puis retrouvé dans la fiche du contrat", async () => {
    const emp = await prisma.employee.create({ data: { firstName: "Ave", lastName: "Nant" } });
    const c = await prisma.hrContract.create({ data: { employeeId: emp.id, type: "cdi", startDate: new Date() } });
    const add = await app.inject({
      method: "POST",
      url: `/api/v1/employees/${emp.id}/contracts/${c.id}/amendments`,
      headers: { cookie },
      payload: { effective_date: new Date().toISOString(), subject: "Augmentation du salaire de base", description: "Passage à l'échelon supérieur." },
    });
    expect(add.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/api/v1/employees/${emp.id}/contracts`, headers: { cookie } });
    const contract = (list.json() as { id: string; amendments: { subject: string }[] }[]).find((x) => x.id === c.id)!;
    expect(contract.amendments.length).toBe(1);
    expect(contract.amendments[0].subject).toContain("Augmentation");
  });

  it("avenant : 404 si le contrat n'appartient pas à l'employé", async () => {
    const emp = await prisma.employee.create({ data: { firstName: "X", lastName: "Y" } });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/employees/${emp.id}/contracts/00000000-0000-0000-0000-000000000000/amendments`,
      headers: { cookie },
      payload: { effective_date: new Date().toISOString(), subject: "Test" },
    });
    expect(res.statusCode).toBe(404);
  });
});
