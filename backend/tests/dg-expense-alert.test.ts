import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Alerte DG — dépenses en attente de contre-validation (D-040) : lorsqu'une
// dépense est soumise au DG (palier 1), le tableau de bord Direction affiche une
// alerte « Validation des dépenses — N en attente » et le DG reçoit une notification.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Alerte DG — dépenses à contre-valider (D-040)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let dgId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    await createUserWithRole("resp_finance_dgalert", "RESP_FINANCE", "RespFinance123!");
    dgId = (await createUserWithRole("dir_general_dgalert", "DIR_GENERAL", "DirGeneral123!")).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("une dépense soumise au DG crée l'alerte tableau de bord + une notification au DG", async () => {
    const respFinanceCookie = await login("resp_finance_dgalert", "RespFinance123!");

    const expense = await app.inject({ method: "POST", url: "/api/v1/expenses", headers: { cookie: adminCookie }, payload: { category: "prestation", amount: 42000, description: "Prestation alerte DG" } });
    const expenseId = expense.json().id as string;

    // Palier 1 : la Finance valide → en_attente_dg (déclenche l'alerte + la notif).
    const palier1 = await app.inject({ method: "PATCH", url: `/api/v1/expenses/${expenseId}/validate`, headers: { cookie: respFinanceCookie }, payload: {} });
    expect(palier1.statusCode).toBe(200);
    expect(palier1.json().status).toBe("en_attente_dg");

    // Alerte tableau de bord Direction.
    const alerts = await app.inject({ method: "GET", url: "/api/v1/alerts", headers: { cookie: adminCookie } });
    expect(alerts.statusCode).toBe(200);
    const alert = (alerts.json() as Array<{ type: string; entity_type: string; message: string }>).find((a) => a.type === "depense_validation_dg");
    expect(alert).toBeTruthy();
    expect(alert!.entity_type).toBe("expense_validation");
    expect(alert!.message).toMatch(/Validation des dépenses/);

    // Notification poussée au DG (rôle DIR_GENERAL).
    const notif = await prisma.notification.findFirst({ where: { userId: dgId, entityType: "expense", entityId: expenseId } });
    expect(notif).toBeTruthy();
    expect(notif!.type).toBe("validation");
  });
});
