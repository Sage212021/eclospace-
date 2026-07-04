import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("RH, pilotage et rapports (Lot 6)", () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // --- RH : dossier collaborateur et cycle de vie (Ch. 19 §19.2-19.4) ---

  it("crée un dossier avec compte utilisateur et notifie le responsable à l'arrivée (Ch. 19 §19.3)", async () => {
    const rhDept = await prisma.department.findUniqueOrThrow({ where: { code: "RH" } });
    const manager = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: {
        first_name: "Manager",
        last_name: "Test",
        department_id: rhDept.id,
        account: { username: "manager_arrivee_test", email: "manager.arrivee@eclospace.local", password: "ManagerTest123!", role_code: "RESP_RH" },
      },
    });
    expect(manager.statusCode).toBe(201);

    const employee = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: {
        first_name: "Nouvel",
        last_name: "Arrivant",
        department_id: rhDept.id,
        manager_id: manager.json().id,
        account: { username: "arrivant_test", email: "arrivant@eclospace.local", password: "ArrivantTest123!", role_code: "ASSISTANT_EDITORIAL" },
      },
    });
    expect(employee.statusCode).toBe(201);

    const managerUser = await prisma.user.findUniqueOrThrow({ where: { username: "manager_arrivee_test" } });
    const notification = await prisma.notification.findFirst({ where: { userId: managerUser.id, entityType: "employee", entityId: employee.json().id } });
    expect(notification).not.toBeNull();

    const newUser = await prisma.user.findUniqueOrThrow({ where: { username: "arrivant_test" } });
    expect(newUser.status).toBe("active");
    const userRole = await prisma.userRole.findFirst({ where: { userId: newUser.id, role: { code: "ASSISTANT_EDITORIAL" } } });
    expect(userRole).not.toBeNull();
  });

  it("désactive le compte immédiatement si la date de départ est déjà passée (Ch. 19 §19.3)", async () => {
    const employee = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: {
        first_name: "Partant",
        last_name: "Immediat",
        account: { username: "partant_immediat_test", email: "partant.immediat@eclospace.local", password: "PartantTest123!", role_code: "ASSISTANT_EDITORIAL" },
      },
    });
    const departure = await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${employee.json().id}/departure`,
      headers: { cookie: adminCookie },
      payload: { date: "2020-01-01T00:00:00.000Z" },
    });
    expect(departure.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { username: "partant_immediat_test" } });
    expect(user.status).toBe("disabled");
  });

  it("désactive le compte de façon paresseuse à la prochaine connexion si la date de départ vient d'être atteinte (Ch. 19 §19.3)", async () => {
    const employee = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: {
        first_name: "Partant",
        last_name: "Futur",
        account: { username: "partant_futur_test", email: "partant.futur@eclospace.local", password: "PartantTest123!", role_code: "ASSISTANT_EDITORIAL" },
      },
    });
    const futureDate = new Date(Date.now() + 500).toISOString(); // dans 0,5 seconde
    await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${employee.json().id}/departure`,
      headers: { cookie: adminCookie },
      payload: { date: futureDate },
    });
    const userBefore = await prisma.user.findUniqueOrThrow({ where: { username: "partant_futur_test" } });
    expect(userBefore.status).toBe("active"); // pas encore passé

    await new Promise((resolve) => setTimeout(resolve, 700));

    const meAttempt = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: await loginCookie(app, "partant_futur_test", "PartantTest123!").catch(() => "") } });
    // La connexion elle-même doit désormais échouer car le compte est désactivé
    // au moment de la résolution de session (lib/permissions.ts).
    const loginAttempt = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "partant_futur_test", password: "PartantTest123!" } });
    expect(loginAttempt.statusCode).toBe(401);

    const userAfter = await prisma.user.findUniqueOrThrow({ where: { username: "partant_futur_test" } });
    expect(userAfter.status).toBe("disabled");
  });

  it("suspend puis réintègre un compte sans perte de données (Ch. 19 §19.3)", async () => {
    const employee = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: {
        first_name: "Suspendu",
        last_name: "Test",
        account: { username: "suspendu_test", email: "suspendu@eclospace.local", password: "SuspenduTest123!", role_code: "ASSISTANT_EDITORIAL" },
      },
    });
    const suspend = await app.inject({ method: "PATCH", url: `/api/v1/employees/${employee.json().id}/suspend`, headers: { cookie: adminCookie }, payload: {} });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().status).toBe("suspended");

    const reinstate = await app.inject({ method: "PATCH", url: `/api/v1/employees/${employee.json().id}/reinstate`, headers: { cookie: adminCookie }, payload: {} });
    expect(reinstate.statusCode).toBe(200);
    expect(reinstate.json().status).toBe("active");
  });

  // --- Confidentialité (Ch. 19 §19.2) ---

  it("restreint l'accès aux données confidentielles et journalise chaque consultation (Ch. 19 §19.2)", async () => {
    const employee = await app.inject({ method: "POST", url: "/api/v1/employees", headers: { cookie: adminCookie }, payload: { first_name: "Confidentiel", last_name: "Test" } });
    await createUserWithRole("assistant_confidentiel_test", "ASSISTANT_EDITORIAL", "AssistantTest123!");
    const nonAuthorizedCookie = await loginCookie(app, "assistant_confidentiel_test", "AssistantTest123!");

    const refused = await app.inject({ method: "GET", url: `/api/v1/employees/${employee.json().id}/confidential`, headers: { cookie: nonAuthorizedCookie } });
    expect(refused.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${employee.json().id}/confidential`,
      headers: { cookie: adminCookie },
      payload: { base_salary: 500000, notes: "RAS" },
    });
    expect(allowed.statusCode).toBe(200);

    const read = await app.inject({ method: "GET", url: `/api/v1/employees/${employee.json().id}/confidential`, headers: { cookie: adminCookie } });
    expect(read.statusCode).toBe(200);
    expect(Number(read.json().baseSalary)).toBe(500000);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "employee_confidential", entityId: employee.json().id, action: "view_sensitive" },
    });
    expect(auditEntry).not.toBeNull();
  });

  // --- Rôles et habilitations (Ch. 2 §2.4, Ch. 19 §19.4) ---

  it("attribue puis retire un rôle avec justification tracée (Ch. 19 §19.4)", async () => {
    const user = await createUserWithRole("role_grant_test", "ASSISTANT_EDITORIAL", "RoleGrantTest123!");

    const grant = await app.inject({
      method: "POST",
      url: `/api/v1/users/${user.id}/roles`,
      headers: { cookie: adminCookie },
      payload: { role_code: "CORRECTEUR", justification: "Mobilité interne vers la correction." },
    });
    expect(grant.statusCode).toBe(201);

    const revoke = await app.inject({
      method: "PATCH",
      url: `/api/v1/user-roles/${grant.json().id}/revoke`,
      headers: { cookie: adminCookie },
      payload: { justification: "Fin de la mobilité." },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revokedAt).not.toBeNull();
  });

  it("détecte les anomalies d'habilitation (Ch. 19 §19.4)", async () => {
    // Compte actif sans dossier RH (créé directement, sans passer par POST /employees).
    await createUserWithRole("sans_dossier_rh_test", "ASSISTANT_EDITORIAL", "SansDossierTest123!");

    const anomalies = await app.inject({ method: "GET", url: "/api/v1/access-anomalies", headers: { cookie: adminCookie } });
    expect(anomalies.statusCode).toBe(200);
    expect(anomalies.json().some((a: { type: string; username: string }) => a.type === "compte_sans_dossier_rh" && a.username === "sans_dossier_rh_test")).toBe(true);
  });

  it("lance une campagne de revue des accès et enregistre la décision du responsable (Ch. 19 §19.4)", async () => {
    const rhDept = await prisma.department.findUniqueOrThrow({ where: { code: "RH" } });
    const manager = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: {
        first_name: "Reviseur",
        last_name: "Test",
        department_id: rhDept.id,
        account: { username: "reviseur_test", email: "reviseur@eclospace.local", password: "ReviseurTest123!", role_code: "RESP_RH" },
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: { first_name: "Revu", last_name: "Test", department_id: rhDept.id, manager_id: manager.json().id },
    });

    const review = await app.inject({ method: "POST", url: "/api/v1/access-reviews", headers: { cookie: adminCookie }, payload: { label: "Revue semestrielle test" } });
    expect(review.statusCode).toBe(201);

    const reviewerCookie = await loginCookie(app, "reviseur_test", "ReviseurTest123!");
    const items = await app.inject({ method: "GET", url: `/api/v1/access-reviews/${review.json().id}/items?reviewer=me`, headers: { cookie: reviewerCookie } });
    expect(items.statusCode).toBe(200);
    expect(items.json().length).toBeGreaterThan(0);

    const decided = await app.inject({
      method: "PATCH",
      url: `/api/v1/access-review-items/${items.json()[0].id}`,
      headers: { cookie: reviewerCookie },
      payload: { decision: "confirme" },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().decidedAt).not.toBeNull();
  });

  // --- Absences et disponibilité (Ch. 19 §19.5) ---

  it("valide une demande de congé et décrémente le solde (Ch. 19 §19.5)", async () => {
    const employeeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: adminCookie },
      payload: { first_name: "Conge", last_name: "Test" },
    });
    const employeeId = employeeResponse.json().id as string;
    await prisma.employee.update({ where: { id: employeeId }, data: { leaveBalanceDays: 25 } });

    const absence = await app.inject({
      method: "POST",
      url: "/api/v1/absences",
      headers: { cookie: adminCookie },
      payload: { employee_id: employeeId, type: "conge", from_date: "2026-08-01T00:00:00.000Z", to_date: "2026-08-05T00:00:00.000Z" },
    });
    expect(absence.statusCode).toBe(201);

    const decided = await app.inject({
      method: "PATCH",
      url: `/api/v1/absences/${absence.json().id}/decide`,
      headers: { cookie: adminCookie },
      payload: { decision: "validee" },
    });
    expect(decided.statusCode).toBe(200);

    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(Number(employeeAfter.leaveBalanceDays)).toBe(20); // 25 - 5 jours (1er au 5 août inclus)

    const alreadyDecided = await app.inject({
      method: "PATCH",
      url: `/api/v1/absences/${absence.json().id}/decide`,
      headers: { cookie: adminCookie },
      payload: { decision: "validee" },
    });
    expect(alreadyDecided.statusCode).toBe(409);
  });

  it("expose la disponibilité pour alimenter le Gantt (Ch. 19 §19.5, Ch. 8 §8.7)", async () => {
    const availability = await app.inject({
      method: "GET",
      url: "/api/v1/availability?period_start=2026-08-01T00:00:00.000Z&period_end=2026-08-31T00:00:00.000Z",
      headers: { cookie: adminCookie },
    });
    expect(availability.statusCode).toBe(200);
    expect(Array.isArray(availability.json())).toBe(true);
  });

  // --- Permissions (échantillon, Plan §4.1) ---

  it("refuse l'accès RH, direction, pilotage et rapports à un rôle non autorisé", async () => {
    await createUserWithRole("correcteur_lot6_test", "CORRECTEUR", "CorrecteurTest123!");
    const cookie = await loginCookie(app, "correcteur_lot6_test", "CorrecteurTest123!");

    const rh = await app.inject({ method: "POST", url: "/api/v1/employees", headers: { cookie }, payload: { first_name: "X", last_name: "Y" } });
    expect(rh.statusCode).toBe(403);

    const direction = await app.inject({ method: "GET", url: "/api/v1/dashboards/direction", headers: { cookie } });
    expect(direction.statusCode).toBe(403);

    const pilotage = await app.inject({ method: "GET", url: "/api/v1/recommendations", headers: { cookie } });
    expect(pilotage.statusCode).toBe(403);

    const rapports = await app.inject({ method: "GET", url: "/api/v1/reports", headers: { cookie } });
    expect(rapports.statusCode).toBe(403);
  });

  // --- Direction générale : tableau de bord, recherche, alertes (Ch. 5) ---

  it("calcule le tableau de bord consolidé de la Direction générale (Ch. 5 §5.3)", async () => {
    const dashboard = await app.inject({ method: "GET", url: "/api/v1/dashboards/direction", headers: { cookie: adminCookie } });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().editorial.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(dashboard.json().editorial.by_status)).toBe(true);
    expect(dashboard.json().financial).not.toBeNull(); // admin a finance:consultation
  });

  it("masque les indicateurs financiers à un profil sans finance:consultation (Ch. 5 §5.2)", async () => {
    await createUserWithRole("dir_editorial_lot6_test", "DIR_EDITORIAL", "DirEditorialTest123!");
    const cookie = await loginCookie(app, "dir_editorial_lot6_test", "DirEditorialTest123!");
    const dashboard = await app.inject({ method: "GET", url: "/api/v1/dashboards/direction", headers: { cookie } });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().financial).toBeNull();
  });

  it("effectue une recherche combinée sur les manuscrits (Ch. 5 §5.4)", async () => {
    const search = await app.inject({ method: "GET", url: "/api/v1/search?q=a", headers: { cookie: adminCookie } });
    expect(search.statusCode).toBe(200);
    expect(Array.isArray(search.json())).toBe(true);
  });

  it("calcule les alertes automatiques avec niveaux de priorité (Ch. 5 §5.6)", async () => {
    const alerts = await app.inject({ method: "GET", url: "/api/v1/alerts", headers: { cookie: adminCookie } });
    expect(alerts.statusCode).toBe(200);
    for (const alert of alerts.json()) {
      expect(["faible", "moyenne", "elevee", "critique"]).toContain(alert.priority);
    }
  });

  // --- Centre de pilotage intelligent (Ch. 5 §5.9, Ch. 20 §20.6) ---

  it("génère des recommandations à la demande sans dupliquer une recommandation déjà ouverte (Ch. 5 §5.9)", async () => {
    const first = await app.inject({ method: "POST", url: "/api/v1/recommendations/generate", headers: { cookie: adminCookie }, payload: {} });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/api/v1/recommendations/generate", headers: { cookie: adminCookie }, payload: {} });
    expect(second.statusCode).toBe(201);
    expect(second.json().created).toBe(0); // rien de nouveau : les recommandations ouvertes ne sont pas dupliquées

    const list = await app.inject({ method: "GET", url: "/api/v1/recommendations?status=open", headers: { cookie: adminCookie } });
    expect(list.statusCode).toBe(200);
    if (list.json().length > 0) {
      const treat = await app.inject({
        method: "PATCH",
        url: `/api/v1/recommendations/${list.json()[0].id}`,
        headers: { cookie: adminCookie },
        payload: { status: "treated", comment: "Pris en compte." },
      });
      expect(treat.statusCode).toBe(200);
      expect(treat.json().status).toBe("treated");
    }
  });

  // --- Rapports, dictionnaire d'indicateurs, explorateur (Ch. 20) ---

  it("calcule un indicateur du dictionnaire avec sa définition (Ch. 20 §20.2)", async () => {
    const kpi = await app.inject({ method: "GET", url: "/api/v1/kpi/treasury_position", headers: { cookie: adminCookie } });
    expect(kpi.statusCode).toBe(200);
    expect(kpi.json().definition).toBeTruthy();
    expect(kpi.json().formula).toBeTruthy();
    expect(typeof kpi.json().value).toBe("number");
  });

  it("génère un rapport standard du catalogue (Ch. 20 §20.3)", async () => {
    const catalog = await app.inject({ method: "GET", url: "/api/v1/reports", headers: { cookie: adminCookie } });
    expect(catalog.statusCode).toBe(200);
    const rhReport = catalog.json().find((r: { key: string }) => r.key === "rh_workload");
    expect(rhReport).toBeTruthy();

    const run = await app.inject({ method: "POST", url: `/api/v1/reports/${rhReport.id}/run`, headers: { cookie: adminCookie }, payload: {} });
    expect(run.statusCode).toBe(201);
    expect(Array.isArray(run.json().rows)).toBe(true);

    const runs = await app.inject({ method: "GET", url: `/api/v1/reports/${rhReport.id}/runs`, headers: { cookie: adminCookie } });
    expect(runs.json().length).toBeGreaterThan(0);
  });

  it("enregistre, exécute et partage une analyse de l'explorateur (Ch. 20 §20.4)", async () => {
    const analysis = await app.inject({
      method: "POST",
      url: "/api/v1/analyses",
      headers: { cookie: adminCookie },
      payload: { label: "CA net courant", definition: { metric: "revenue_total" } },
    });
    expect(analysis.statusCode).toBe(201);

    const run = await app.inject({ method: "POST", url: `/api/v1/analyses/${analysis.json().id}/run`, headers: { cookie: adminCookie }, payload: {} });
    expect(run.statusCode).toBe(200);
    expect(typeof run.json().value).toBe("number");

    const invalidMetric = await app.inject({
      method: "POST",
      url: "/api/v1/analyses",
      headers: { cookie: adminCookie },
      payload: { label: "Invalide", definition: { metric: "metrique_inexistante" } },
    });
    expect(invalidMetric.statusCode).toBe(400);
  });

  it("simule des hypothèses de tirage en croisant devis et rythme de vente (Ch. 20 §20.6)", async () => {
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    const manuscript = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title: "Manuscrit Simulation Tirage", genre_id: genre.id, language: "fr", owner_id: admin.id, author: { first_name: "Auteur", last_name: "Simulation" } },
    });

    const simulation = await app.inject({
      method: "POST",
      url: "/api/v1/simulations/print-run",
      headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscript.json().id, quantities: [500, 1000] },
    });
    expect(simulation.statusCode).toBe(200);
    expect(simulation.json().simulations).toHaveLength(2);
    expect(simulation.json().simulations[0].total_cost).toBeNull(); // aucun devis chiffré pour ce manuscrit de test
  });
});
