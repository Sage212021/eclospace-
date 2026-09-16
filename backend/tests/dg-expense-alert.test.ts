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

    // Palier 2 : le DG contre-valide effectivement → « validee » (D-046 : la
    // contre-validation passe par le rôle DIR_GENERAL, sans dépendre d'un droit
    // d'administration Finance distinct).
    const dgCookie = await login("dir_general_dgalert", "DirGeneral123!");
    const palier2 = await app.inject({ method: "PATCH", url: `/api/v1/expenses/${expenseId}/validate`, headers: { cookie: dgCookie }, payload: {} });
    expect(palier2.statusCode).toBe(200);
    expect(palier2.json().status).toBe("validee");
  });

  it("le palier 1 (première validation) est refusé à un rôle finance:validation sans administration", async () => {
    // Rôle « validation seule » (ni administration Finance, ni DG) : ne peut PAS
    // initier la première validation d'une dépense (réservée au DAF).
    const role = await prisma.role.upsert({ where: { code: "TEST_FIN_VALID_ONLY" }, update: {}, create: { code: "TEST_FIN_VALID_ONLY", label: "Finance validation (test)" } });
    const perm = await prisma.permission.findFirstOrThrow({ where: { module: "finance", action: "validation" } });
    await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, update: {}, create: { roleId: role.id, permissionId: perm.id } });
    await createUserWithRole("fin_valid_only", "TEST_FIN_VALID_ONLY", "FinValid123!");
    const cookie = await login("fin_valid_only", "FinValid123!");

    const expense = await app.inject({ method: "POST", url: "/api/v1/expenses", headers: { cookie: adminCookie }, payload: { category: "prestation", amount: 15000, description: "Palier 1 interdit" } });
    const res = await app.inject({ method: "PATCH", url: `/api/v1/expenses/${expense.json().id}/validate`, headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("daf_validation_required");
  });
});
