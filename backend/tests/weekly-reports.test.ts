import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Rapports hebdomadaires (Demande 3). On vérifie le cycle rédiger → soumettre →
// valider, la confidentialité (un agent ne voit pas le rapport d'un autre) et
// l'habilitation (objectifs réservés chef/DG ; validation DG par défaut).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("rapports hebdomadaires (Lot rapports)", () => {
  let app: FastifyInstance;
  let adminCookie: string; // oversight (direction:consultation)
  let aCookie: string;
  let bCookie: string;
  let agentA: { id: string };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const s = Math.random().toString(36).slice(2, 6);
    agentA = await createUserWithRole(`agentA_${s}`, "CORRECTEUR", "AgentA123!");
    await createUserWithRole(`agentB_${s}`, "CORRECTEUR", "AgentB123!");
    aCookie = await loginCookie(app, `agentA_${s}`, "AgentA123!");
    bCookie = await loginCookie(app, `agentB_${s}`, "AgentB123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("cycle complet : créer → éditer → soumettre → valider (DG)", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/weekly-reports", headers: { cookie: aCookie } });
    expect([200, 201]).toContain(create.statusCode);
    const report = create.json();
    expect(report.status).toBe("draft");

    // Rappeler le même rapport pour la période ne le duplique pas.
    const again = await app.inject({ method: "POST", url: "/api/v1/weekly-reports", headers: { cookie: aCookie } });
    expect(again.json().id).toBe(report.id);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/weekly-reports/${report.id}`,
      headers: { cookie: aCookie },
      payload: {
        achievements: "3 manuscrits corrigés.",
        research: "Veille typographique.",
        objectives: [{ label: "Corriger 8 manuscrits/mois", progress_pct: 40, comment: "En bonne voie" }],
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().objectives).toHaveLength(1);
    expect(patch.json().objectives[0].progressPct).toBe(40);

    const submit = await app.inject({ method: "POST", url: `/api/v1/weekly-reports/${report.id}/submit`, headers: { cookie: aCookie } });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().status).toBe("submitted");

    // Un rapport soumis n'est plus éditable par l'auteur.
    const lateEdit = await app.inject({ method: "PATCH", url: `/api/v1/weekly-reports/${report.id}`, headers: { cookie: aCookie }, payload: { achievements: "x" } });
    expect(lateEdit.statusCode).toBe(409);

    // Validation par la DG (admin = oversight).
    const val = await app.inject({ method: "POST", url: `/api/v1/weekly-reports/${report.id}/validate`, headers: { cookie: adminCookie }, payload: { decision: "validate", comment: "Bon travail." } });
    expect(val.statusCode).toBe(200);
    expect(val.json().status).toBe("validated");
  });

  it("confidentialité : un agent ne voit pas le rapport d'un autre (403)", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/weekly-reports", headers: { cookie: aCookie } });
    const reportId = create.json().id;
    const asB = await app.inject({ method: "GET", url: `/api/v1/weekly-reports/${reportId}`, headers: { cookie: bCookie } });
    expect(asB.statusCode).toBe(403);
    // L'oversight (admin) le voit.
    const asAdmin = await app.inject({ method: "GET", url: `/api/v1/weekly-reports/${reportId}`, headers: { cookie: adminCookie } });
    expect(asAdmin.statusCode).toBe(200);
  });

  it("validation refusée à un non-habilité en mode DG (403)", async () => {
    // Rapport de B, soumis par B ; A (ni DG ni chef) tente de valider.
    const create = await app.inject({ method: "POST", url: "/api/v1/weekly-reports", headers: { cookie: bCookie } });
    const reportId = create.json().id;
    const submit = await app.inject({ method: "POST", url: `/api/v1/weekly-reports/${reportId}/submit`, headers: { cookie: bCookie } });
    expect(submit.statusCode).toBe(200);
    const byA = await app.inject({ method: "POST", url: `/api/v1/weekly-reports/${reportId}/validate`, headers: { cookie: aCookie }, payload: { decision: "validate" } });
    expect(byA.statusCode).toBe(403);
  });

  it("un chef de département ne voit PLUS les rapports des autres (403)", async () => {
    const s = Math.random().toString(36).slice(2, 6);
    await createUserWithRole(`auth_${s}`, "CORRECTEUR", "Auth123!");
    const authCookie = await loginCookie(app, `auth_${s}`, "Auth123!");
    await createUserWithRole(`chef_${s}`, "CHEF_DEPARTEMENT", "Chef123!");
    const chefCookie = await loginCookie(app, `chef_${s}`, "Chef123!");
    const reportId = (await app.inject({ method: "POST", url: "/api/v1/weekly-reports", headers: { cookie: authCookie } })).json().id;
    await app.inject({ method: "POST", url: `/api/v1/weekly-reports/${reportId}/submit`, headers: { cookie: authCookie } });
    const asChef = await app.inject({ method: "GET", url: `/api/v1/weekly-reports/${reportId}`, headers: { cookie: chefCookie } });
    expect(asChef.statusCode).toBe(403);
  });

  it("le RH VOIT un rapport soumis mais ne peut PAS le valider (403)", async () => {
    const s = Math.random().toString(36).slice(2, 6);
    await createUserWithRole(`auth2_${s}`, "CORRECTEUR", "Auth123!");
    const authCookie = await loginCookie(app, `auth2_${s}`, "Auth123!");
    await createUserWithRole(`rh_${s}`, "RESP_RH", "RhPass123!");
    const rhCookie = await loginCookie(app, `rh_${s}`, "RhPass123!");
    const reportId = (await app.inject({ method: "POST", url: "/api/v1/weekly-reports", headers: { cookie: authCookie } })).json().id;
    await app.inject({ method: "POST", url: `/api/v1/weekly-reports/${reportId}/submit`, headers: { cookie: authCookie } });
    // RH : lecture autorisée…
    expect((await app.inject({ method: "GET", url: `/api/v1/weekly-reports/${reportId}`, headers: { cookie: rhCookie } })).statusCode).toBe(200);
    // …mais validation refusée (réservée DG / Admin).
    const rhValidate = await app.inject({ method: "POST", url: `/api/v1/weekly-reports/${reportId}/validate`, headers: { cookie: rhCookie }, payload: { decision: "validate" } });
    expect(rhValidate.statusCode).toBe(403);
  });

  it("objectifs : un agent ordinaire ne peut pas en créer (403), la DG oui", async () => {
    const period = { period_start: "2026-07-01T00:00:00.000Z", period_end: "2026-07-31T00:00:00.000Z" };
    const byAgent = await app.inject({
      method: "POST",
      url: "/api/v1/objectives",
      headers: { cookie: aCookie },
      payload: { user_id: agentA.id, title: "Objectif test", ...period },
    });
    expect(byAgent.statusCode).toBe(403);

    const byAdmin = await app.inject({
      method: "POST",
      url: "/api/v1/objectives",
      headers: { cookie: adminCookie },
      payload: { user_id: agentA.id, title: "Corriger 8 manuscrits/mois", target_value: 8, unit: "manuscrits", ...period },
    });
    expect(byAdmin.statusCode).toBe(201);
    expect(Number(byAdmin.json().targetValue)).toBe(8);
  });
});
